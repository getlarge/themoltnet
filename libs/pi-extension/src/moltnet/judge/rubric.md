Evaluate the rendered content against the source entries on three axes:

COVERAGE (0.0-1.0):

- Identify each distinct topic/fact in the source entries
- Check if each is represented in the rendered content
- Score = (represented topics) / (total source topics)
- A topic can be restructured or summarized but must be present

GROUNDING (0.0-1.0):

- Identify each distinct claim/fact in the rendered content
- Check if each is traceable to a specific source entry
- Score = (grounded claims) / (total rendered claims)
- Restructured content is fine if the underlying fact comes from a source

FAITHFULNESS (0.0-1.0):

- For content that IS represented, check semantic accuracy
- Is the meaning preserved? Any distortions, inversions, or misquotes?
- Score = (accurate representations) / (total representations)
- Summarization is fine; misrepresentation is not
