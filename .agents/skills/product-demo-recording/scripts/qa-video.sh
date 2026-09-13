#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <video> <new-output-directory> [contact-sheet-interval-seconds] [timestamp ...]" >&2
}

if (( $# < 2 )); then
  usage
  exit 2
fi

video=$1
output_dir=$2
requested_interval=${3:-2}

if [[ ! -f $video ]]; then
  echo "Video does not exist: $video" >&2
  exit 1
fi

if [[ -e $output_dir ]]; then
  echo "Output path already exists; choose a fresh directory: $output_dir" >&2
  exit 1
fi

if ! [[ $requested_interval =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  echo "Contact-sheet interval must be a positive number" >&2
  exit 2
fi

for command in ffmpeg ffprobe awk; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command not found: $command" >&2
    exit 1
  fi
done

mkdir -p "$output_dir"

ffprobe -v error \
  -show_entries format=duration,size,format_name:stream=index,codec_name,profile,width,height,pix_fmt,r_frame_rate,avg_frame_rate \
  -of json "$video" >"$output_dir/metadata.json"

duration=$(ffprobe -v error -show_entries format=duration \
  -of default=noprint_wrappers=1:nokey=1 "$video")
frame_rate=$(ffprobe -v error -select_streams v:0 \
  -show_entries stream=avg_frame_rate \
  -of default=noprint_wrappers=1:nokey=1 "$video")

if [[ -z $frame_rate || $frame_rate == "0/0" ]]; then
  echo "Could not determine the source frame rate" >&2
  exit 1
fi

interval=$(awk -v duration="$duration" -v requested="$requested_interval" \
  'BEGIN {
    minimum = int((duration + 35) / 36)
    if (minimum < 1) minimum = 1
    print (requested > minimum ? requested : minimum)
  }')

ffmpeg -v error -y -threads 1 -i "$video" \
  -vf "fps=${frame_rate},fps=1/${interval},scale=480:-1,tile=6x6:padding=4:margin=4" \
  -frames:v 1 "$output_dir/contact-sheet.jpg"

middle=$(awk -v duration="$duration" 'BEGIN { printf "%.3f", duration / 2 }')
end=$(awk -v duration="$duration" \
  'BEGIN {
    timestamp = duration - 0.1
    if (timestamp < 0) timestamp = 0
    printf "%.3f", timestamp
  }')

extract_frame() {
  local label=$1
  local timestamp=$2

  if ! [[ $timestamp =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    echo "Timestamp must be a non-negative number: $timestamp" >&2
    exit 2
  fi

  ffmpeg -v error -y -threads 1 -i "$video" \
    -vf "fps=${frame_rate},trim=start=${timestamp},setpts=PTS-STARTPTS" \
    -frames:v 1 -q:v 2 "$output_dir/frame-${label}.jpg"
}

extract_frame start 0
extract_frame middle "$middle"
extract_frame end "$end"

if (( $# > 3 )); then
  shift 3
  for timestamp in "$@"; do
    label=${timestamp//./_}
    extract_frame "$label" "$timestamp"
  done
fi

echo "QA artifacts written to $output_dir"
echo "Contact-sheet sample interval: ${interval}s"
echo "Inspect metadata.json, contact-sheet.jpg, and every frame-*.jpg file."
