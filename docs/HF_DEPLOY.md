# Deploy docIQ for free (no card)

Backend: Hugging Face Space (Docker, CPU basic, free), built from the repo-root `Dockerfile`.
Frontend: Vercel Hobby (free). It forwards `/api/*` to the Space, so no CORS setup is needed.

## 1. Backend: Hugging Face Space

1. huggingface.co -> New Space. Name `dociq`, SDK **Docker**, hardware **CPU basic (free)**, Public.
2. Settings -> Variables and secrets (all optional; without them it runs the demo with an in-memory database):

| Name | Kind | Value |
|---|---|---|
| `MONGO_URI` | secret | MongoDB Atlas free M0 connection string. Keeps uploads across restarts. |
| `LLM_PROVIDER` | variable | `groq` for written answers. Default `extractive` quotes the text and needs no key. |
| `GROQ_API_KEY` | secret | free Groq key, only with `LLM_PROVIDER=groq` |
| `DEMO_WORKSPACE_KEY` | secret | any long random string (the default is public) |

3. Push the repo to the Space:

```
cd E:\Projects\01-Agent-Systems\docIQ
git remote add space https://huggingface.co/spaces/<you>/dociq
git push space hardening-gaps:main
```

The build takes about 5-10 minutes. Check `https://<you>-dociq.hf.space/api/workspaces/demo` returns the demo workspace.

## 2. Frontend: Vercel

1. vercel.com -> Add New Project -> import `Mokshitsharma/docIQ`, **Root Directory `frontend`**.
2. Environment variable: `BACKEND_URL` = `https://<you>-dociq.hf.space`
3. Deploy. Open the Vercel URL: the demo contract is ready to question.

## Free-tier behaviour

- The Space sleeps after 48 h without visitors; the first visit after that waits 1-2 minutes.
- Without `MONGO_URI`, uploads vanish when the Space restarts; the demo contract is re-seeded each start.
- Demo limits (in the Dockerfile): 5 MB and 100 pages per file, 20 documents, 300 questions a day.
- Workspace keys live in the visitor's browser. Clearing site data loses access to their own workspaces.
