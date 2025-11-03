

PYTHON := $(CURDIR)/.venv/bin/python
PIP := $(CURDIR)/.venv/bin/pip
UVICORN := $(CURDIR)/.venv/bin/uvicorn

.PHONY: test run backend-deps frontend-test invite-codes

backend-deps:
	$(PIP) install -r backend/requirements-dev.txt

frontend-test:
	cd frontend && npm test

INVITE_ARGS ?= list

invite-codes:
	$(PYTHON) -m backend.tools.invite_codes $(INVITE_ARGS)

test: backend-deps
	cd backend && $(PYTHON) -m pytest
	$(MAKE) frontend-test

run:
	@set -e; \
	( cd backend && $(UVICORN) app.main:app --reload --host 0.0.0.0 --port 8000 ) & \
	BACK_PID=$$!; \
	( cd frontend && NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1 npm run dev ) & \
	FRONT_PID=$$!; \
	trap 'kill $$BACK_PID $$FRONT_PID' INT TERM EXIT; \
	wait $$BACK_PID $$FRONT_PID
