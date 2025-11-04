

PYTHON := $(CURDIR)/.venv/bin/python
PIP := $(CURDIR)/.venv/bin/pip
MANAGE := $(PYTHON) manage.py

.PHONY: test run scheduler agent backend-deps frontend-test invite-codes kill

backend-deps:
	$(PIP) install -r backend/requirements-dev.txt

frontend-test:
	cd frontend && npm test

INVITE_ARGS ?= list

invite-codes:
	cd backend && INVITE_USE_SQLITE=1 $(PYTHON) -m tools.invite_codes $(INVITE_ARGS)

KILL_PORTS := 8000 3000

kill:
	@set -e; \
	for port in $(KILL_PORTS); do \
		pids=$$(lsof -ti tcp:$$port 2>/dev/null || true); \
		if [ -n "$$pids" ]; then \
			echo "Killing processes on port $$port: $$pids"; \
			kill $$pids 2>/dev/null || true; \
		else \
			echo "No processes listening on port $$port"; \
		fi; \
	done

test: backend-deps
	cd backend && USE_SQLITE_FOR_TESTS=1 USE_IN_MEMORY_CACHE=1 $(PYTHON) -m pytest
	$(MAKE) frontend-test

run:
	@set -e; \
	( cd backend && USE_SQLITE=1 USE_IN_MEMORY_CACHE=1 $(MANAGE) runserver 0.0.0.0:8000 ) & \
	BACK_PID=$$!; \
	( cd frontend && NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1 npm run dev ) & \
	FRONT_PID=$$!; \
	trap 'kill $$BACK_PID $$FRONT_PID' INT TERM EXIT; \
	wait $$BACK_PID $$FRONT_PID

scheduler:
	cd backend && USE_SQLITE=1 USE_IN_MEMORY_CACHE=1 $(MANAGE) run_scheduler

agent:
	cd backend && AGENT_PORT=8001 SCHEDULER_API_BASE_URL=http://localhost:8000/api/v1 $(PYTHON) -m gpu_agent
