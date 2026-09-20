# Pi harness — web_fetch tool

When `web_fetch` is available in your tool set, use it to retrieve documentation,
API references, paper abstracts, or any publicly accessible resource the task
requires. Apply these rules:

- **Fetch for precision.** Use `web_fetch` when you need exact API signatures,
  flag names, or version-specific behaviour that you are not certain about.
  Do not invent or guess interface details that a fetch could settle.

- **Prefer authoritative sources.** Target official documentation sites, source
  repositories, or standard-body pages rather than search-engine snippets or
  aggregator mirrors. A single authoritative page is better than several
  secondary summaries.

- **One fetch per concrete need.** Batch lookups: if a task requires checking
  three related flags, fetch the single page that documents all three rather
  than fetching three times.

- **Respect truncation.** Responses are capped at 200 KB. If the page is large
  and the content you need appears late in it, consider fetching a more
  targeted sub-page (e.g. a specific section anchor or a raw source file)
  rather than the full page.

- **Non-text responses are not returned.** Binary content (images, PDFs,
  archives) is rejected with a content-type notice. Use text-format alternatives
  (plain API responses, raw source, text/html) instead.

- **Fold fetch errors into the work.** A network error or 4xx/5xx response
  returns a message string rather than raising an exception. Treat it as
  evidence that the resource is unavailable and continue with what you know,
  or explain the gap in your output.

- **Do not loop on failures.** If one URL fails, try at most one alternative.
  Do not retry the same URL repeatedly.
