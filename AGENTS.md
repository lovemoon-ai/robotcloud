# Repository Guidelines

## Project Structure & Module Organization
- `backend/` hosts the FastAPI service; keep domain logic in `app/database.py` and HTTP routes in `app/main.py`, with pytest suites in `backend/tests/`.
- `frontend/` is a Next.js + TypeScript app; shared modules live under `src/` (`api/`, `components/`, `hooks/`, `store/`, `types/`), and Jest tests sit in `frontend/__tests__/`.
- `docs/` stores product and API references; update the relevant file when behavior shifts. The top-level `Makefile` wires backend and frontend tasks.

## Build, Test, and Development Commands
- `python -m venv .venv && make backend-deps` installs backend tooling into the project virtualenv.
- `make test` executes `pytest -q` then `npm test` to keep both stacks green.
- `make run` launches the FastAPI server on `:8000`, the scheduler loop, and the Next dev server on `:3000`, exporting `NEXT_PUBLIC_API_BASE_URL` automatically.
- For frontend-only loops, run `npm run dev`, `npm run lint`, or `npm run build` inside `frontend/`.

## Coding Style & Naming Conventions
- Follow PEP 8 for Python: 4-space indent, snake_case functions, PascalCase classes. Extend `RobotCloudAPI` methods and reuse shared validators before adding new endpoints.
- TypeScript adheres to the Next.js ESLint preset; run `npm run lint` before pushing. Keep React components PascalCase, hooks prefixed with `use`, and state stores following the `useXStore` pattern. Use the `@/` alias for intra-app imports.

## Testing Guidelines
- Place backend tests in `backend/tests/` mirroring module names (`test_main.py`, etc.) and assert response payloads rather than internals. Target new behavior with focused cases.
- Frontend tests belong in `frontend/__tests__/` or alongside the component with a `.test.tsx` suffix. Use Testing Library queries, mock network calls with MSW, and ensure snapshots remain meaningful.

## Commit & Pull Request Guidelines
- Write imperative commit subjects (e.g., `Add FastAPI HTTP layer with tests`); keep scope tight and add context in the body when introducing migrations or config changes.
- PRs must describe the change, mention affected docs, attach UI screenshots or terminal output for visible shifts, and list the commands you ran (`make test`, targeted linting). Link issues or task IDs so history stays traceable.

## Environment & Configuration Tips
- Store local secrets in `.env` files ignored by git; the frontend reads `NEXT_PUBLIC_API_BASE_URL` while the backend uses an in-memory database—no extra services required.
- Local tooling (e.g., `make run`) sets `USE_SQLITE=1` and `USE_IN_MEMORY_CACHE=1` so the stack boots without Postgres or Redis; unset them if you need external services.
- Set `USE_POSTGRES=1` when you want Django to talk to your Postgres instance; otherwise it defaults to sqlite.
- When running both apps manually, export the same base URL to keep API clients pointed at your backend instance.
 - GPU Agent dataset cache root can be overridden with `AGENT_DATASET_DIR` (default: `backend/storage/datasets_cache`).

## Deploy steps
- make run          # backend + scheduler + frontend (dev)
- make scheduler    # run scheduler standalone
- make agent        # launch on GPU machines
