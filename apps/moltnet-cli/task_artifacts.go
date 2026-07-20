package main

import (
	"context"
	"fmt"
	"io"
	"os"

	"github.com/google/uuid"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

type taskArtifactsListOpts struct {
	apiURL    string
	credPath  string
	taskID    string
	teamID    string
	limit     int
	limitSet  bool
	cursor    string
	cursorSet bool
	out       io.Writer
}

type taskArtifactsUploadOpts struct {
	apiURL             string
	credPath           string
	taskID             string
	teamID             string
	attemptN           int
	kind               string
	title              string
	file               string
	contentType        string
	contentTypeSet     bool
	contentEncoding    string
	contentEncodingSet bool
	out                io.Writer
}

type taskArtifactsStageOpts struct {
	apiURL             string
	credPath           string
	teamID             string
	file               string
	contentType        string
	contentTypeSet     bool
	contentEncoding    string
	contentEncodingSet bool
	out                io.Writer
}

type taskArtifactsDownloadOpts struct {
	apiURL     string
	credPath   string
	taskID     string
	teamID     string
	attemptN   int
	attemptSet bool
	cid        string
	outFile    string
	out        io.Writer
}

func runTaskArtifactsStageCmd(opts taskArtifactsStageOpts) error {
	client, err := newClientFromCreds(opts.apiURL, opts.credPath)
	if err != nil {
		return err
	}
	return runTaskArtifactsStageWithClient(context.Background(), client, opts)
}

func runTaskArtifactsStageWithClient(ctx context.Context, client *moltnetapi.Client, opts taskArtifactsStageOpts) error {
	params, err := buildStageTaskArtifactParams(opts)
	if err != nil {
		return err
	}
	reader, closeReader, err := openInputFile(opts.file)
	if err != nil {
		return err
	}
	defer closeReader()

	res, err := client.StageTaskArtifact(ctx, moltnetapi.StageTaskArtifactReq{Data: reader}, params)
	if err != nil {
		return fmt.Errorf("task artifacts stage: %w", formatTransportError(err))
	}
	staged, ok := res.(*moltnetapi.StageTaskArtifactOK)
	if !ok {
		return formatAPIError(res)
	}
	return printJSONTo(opts.out, staged)
}

func buildStageTaskArtifactParams(opts taskArtifactsStageOpts) (moltnetapi.StageTaskArtifactParams, error) {
	teamID, err := uuid.Parse(opts.teamID)
	if err != nil {
		return moltnetapi.StageTaskArtifactParams{}, fmt.Errorf("invalid --team-id %q: %w", opts.teamID, err)
	}
	params := moltnetapi.StageTaskArtifactParams{XMoltnetTeamID: teamID}
	if opts.contentTypeSet {
		params.ContentType = moltnetapi.NewOptString(opts.contentType)
	}
	if opts.contentEncodingSet {
		params.ContentEncoding = moltnetapi.NewOptString(opts.contentEncoding)
	}
	return params, nil
}

func runTaskArtifactsListCmd(opts taskArtifactsListOpts) error {
	client, err := newClientFromCreds(opts.apiURL, opts.credPath)
	if err != nil {
		return err
	}
	return runTaskArtifactsListWithClient(context.Background(), client, opts)
}

func runTaskArtifactsListWithClient(ctx context.Context, client *moltnetapi.Client, opts taskArtifactsListOpts) error {
	params, err := buildListTaskArtifactsParams(opts)
	if err != nil {
		return err
	}
	res, err := client.ListTaskArtifacts(ctx, params)
	if err != nil {
		return fmt.Errorf("task artifacts list: %w", formatTransportError(err))
	}
	page, ok := res.(*moltnetapi.ListTaskArtifactsOK)
	if !ok {
		return formatAPIError(res)
	}
	return printJSONTo(opts.out, page)
}

func buildListTaskArtifactsParams(opts taskArtifactsListOpts) (moltnetapi.ListTaskArtifactsParams, error) {
	taskID, teamID, err := parseTaskArtifactIDs(opts.taskID, opts.teamID)
	if err != nil {
		return moltnetapi.ListTaskArtifactsParams{}, err
	}
	params := moltnetapi.ListTaskArtifactsParams{
		TaskId:         taskID,
		XMoltnetTeamID: teamID,
	}
	if opts.limitSet {
		if opts.limit <= 0 {
			return moltnetapi.ListTaskArtifactsParams{}, fmt.Errorf("--limit must be >= 1, got %d", opts.limit)
		}
		params.Limit = moltnetapi.NewOptInt(opts.limit)
	}
	if opts.cursorSet {
		params.Cursor = moltnetapi.NewOptString(opts.cursor)
	}
	return params, nil
}

func runTaskArtifactsUploadCmd(opts taskArtifactsUploadOpts) error {
	client, err := newClientFromCreds(opts.apiURL, opts.credPath)
	if err != nil {
		return err
	}
	return runTaskArtifactsUploadWithClient(context.Background(), client, opts)
}

func runTaskArtifactsUploadWithClient(ctx context.Context, client *moltnetapi.Client, opts taskArtifactsUploadOpts) error {
	params, err := buildUploadTaskArtifactParams(opts)
	if err != nil {
		return err
	}
	reader, closeReader, err := openInputFile(opts.file)
	if err != nil {
		return err
	}
	defer closeReader()

	res, err := client.UploadTaskArtifact(ctx, moltnetapi.UploadTaskArtifactReq{Data: reader}, params)
	if err != nil {
		return fmt.Errorf("task artifacts upload: %w", formatTransportError(err))
	}
	artifact, ok := res.(*moltnetapi.UploadTaskArtifactOK)
	if !ok {
		return formatAPIError(res)
	}
	return printJSONTo(opts.out, artifact)
}

func buildUploadTaskArtifactParams(opts taskArtifactsUploadOpts) (moltnetapi.UploadTaskArtifactParams, error) {
	taskID, teamID, err := parseTaskArtifactIDs(opts.taskID, opts.teamID)
	if err != nil {
		return moltnetapi.UploadTaskArtifactParams{}, err
	}
	if opts.attemptN <= 0 {
		return moltnetapi.UploadTaskArtifactParams{}, fmt.Errorf("--attempt must be >= 1, got %d", opts.attemptN)
	}
	if opts.kind == "" {
		return moltnetapi.UploadTaskArtifactParams{}, fmt.Errorf("--kind is required")
	}
	if opts.title == "" {
		return moltnetapi.UploadTaskArtifactParams{}, fmt.Errorf("--title is required")
	}
	params := moltnetapi.UploadTaskArtifactParams{
		TaskId:         taskID,
		AttemptN:       opts.attemptN,
		XMoltnetTeamID: teamID,
		Kind:           opts.kind,
		Title:          opts.title,
	}
	if opts.contentTypeSet {
		params.ContentType = moltnetapi.NewOptString(opts.contentType)
	}
	if opts.contentEncodingSet {
		params.ContentEncoding = moltnetapi.NewOptString(opts.contentEncoding)
	}
	return params, nil
}

func runTaskArtifactsDownloadCmd(opts taskArtifactsDownloadOpts) error {
	client, err := newClientFromCreds(opts.apiURL, opts.credPath)
	if err != nil {
		return err
	}
	return runTaskArtifactsDownloadWithClient(context.Background(), client, opts)
}

func runTaskArtifactsDownloadWithClient(ctx context.Context, client *moltnetapi.Client, opts taskArtifactsDownloadOpts) error {
	taskID, teamID, err := parseTaskArtifactIDs(opts.taskID, opts.teamID)
	if err != nil {
		return err
	}
	if opts.cid == "" {
		return fmt.Errorf("--cid is required")
	}
	if opts.outFile == "" {
		return fmt.Errorf("--out is required")
	}
	if opts.attemptSet && opts.attemptN <= 0 {
		return fmt.Errorf("--attempt must be >= 1, got %d", opts.attemptN)
	}
	writer, closeWriter, err := openOutputFile(opts.outFile, opts.out)
	if err != nil {
		return err
	}
	defer closeWriter()

	if opts.attemptSet {
		res, err := client.DownloadTaskArtifact(ctx, moltnetapi.DownloadTaskArtifactParams{
			TaskId: taskID, AttemptN: opts.attemptN, Cid: opts.cid, XMoltnetTeamID: teamID,
		})
		if err != nil {
			return fmt.Errorf("task artifacts download: %w", formatTransportError(err))
		}
		download, ok := res.(*moltnetapi.DownloadTaskArtifactOKHeaders)
		if !ok {
			return formatAPIError(res)
		}
		_, err = io.Copy(writer, download.Response.Data)
		return err
	}

	res, err := client.DownloadTaskArtifactByCid(ctx, moltnetapi.DownloadTaskArtifactByCidParams{
		TaskId: taskID, Cid: opts.cid, XMoltnetTeamID: teamID,
	})
	if err != nil {
		return fmt.Errorf("task artifacts download: %w", formatTransportError(err))
	}
	download, ok := res.(*moltnetapi.DownloadTaskArtifactByCidOKHeaders)
	if !ok {
		return formatAPIError(res)
	}
	_, err = io.Copy(writer, download.Response.Data)
	return err
}

func parseTaskArtifactIDs(taskIDRaw, teamIDRaw string) (uuid.UUID, uuid.UUID, error) {
	taskID, err := uuid.Parse(taskIDRaw)
	if err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("invalid task ID %q: %w", taskIDRaw, err)
	}
	teamID, err := uuid.Parse(teamIDRaw)
	if err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("invalid --team-id %q: %w", teamIDRaw, err)
	}
	return taskID, teamID, nil
}

func openInputFile(path string) (io.Reader, func(), error) {
	if path == "" || path == "-" {
		return os.Stdin, func() {}, nil
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, func() {}, fmt.Errorf("open --file %q: %w", path, err)
	}
	return f, func() { _ = f.Close() }, nil
}

func openOutputFile(path string, stdout io.Writer) (io.Writer, func(), error) {
	if path == "-" {
		return stdout, func() {}, nil
	}
	f, err := os.Create(path)
	if err != nil {
		return nil, func() {}, fmt.Errorf("open --out %q: %w", path, err)
	}
	return f, func() { _ = f.Close() }, nil
}
