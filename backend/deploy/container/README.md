---
title: docIQ API
emoji: 📄
colorFrom: gray
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
short_description: Document Q&A with cited answers and clause risk scanning
---

# docIQ: API

The backend for docIQ, an AI document intelligence platform. Upload PDF or DOCX contracts, invoices or policies and ask questions. Every answer cites the passage it came from, and a risk scan flags clauses worth reviewing.

This demo runs fully offline:
- an in-memory database, seeded with a sample contract on every start
- local embeddings
- extractive answers, so no LLM key is needed

To get full LLM answers, set `LLM_PROVIDER=groq` and a `GROQ_API_KEY` secret.

The web app is the Next.js frontend on Vercel.
