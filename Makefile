.PHONY: test run run-all scheduler agent agent-4090 backend-deps frontend-test invite-codes kill

ifneq (,$(wildcard .env))
include .env
export $(shell sed -n 's/^[[:space:]]*\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' .env)
endif

REQUIRED_ENV_VARS := \
	BACKEND_HOST \
	BACKEND_PORT \
	FRONTEND_HOST \
	FRONTEND_PORT \
	PUBLIC_API_BASE_URL \
	DJANGO_ALLOWED_HOSTS \
	DJANGO_CORS_ALLOWED_ORIGINS \
	SCHEDULER_API_BASE_URL \
	AGENT_PORT \
	AGENT_IP \
	AGENT_NODE_NAME

$(foreach var,$(REQUIRED_ENV_VARS),$(if $($(var)),,$(error Missing environment variable '$(var)'. Configure it in .env)))

# PYTHON := /usr/bin/python3
PYTHON := $(CURDIR)/.venv/bin/python
PIP := $(CURDIR)/.venv/bin/pip
MANAGE := $(PYTHON) manage.py

####### DEVELOP ########

backend-deps:
	$(PIP) install -r backend/requirements-dev.txt
	cd backend && $(PIP) install ".[all]"

front-deps:
	cd frontend && npm install

frontend-test:
	cd frontend && npm test

INVITE_ARGS ?= list

invite-codes:
	cd backend && INVITE_USE_SQLITE=1 $(PYTHON) -m tools.invite_codes $(INVITE_ARGS)

KILL_PORTS := $(BACKEND_PORT) $(FRONTEND_PORT) $(AGENT_PORT)

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
	done; \
	# Kill Django run_scheduler processes
	sched_pids=$$(ps ax -o pid= -o command= | grep -E "[m]anage.py run_scheduler" | awk '{print $$1}' | tr '\n' ' '); \
	if [ -n "$$sched_pids" ]; then \
		echo "Killing run_scheduler processes: $$sched_pids"; \
		kill $$sched_pids 2>/dev/null || true; \
	else \
		echo "No run_scheduler processes found"; \
	fi

test: backend-deps
	cd backend && USE_SQLITE_FOR_TESTS=1 USE_IN_MEMORY_CACHE=1 $(PYTHON) -m pytest
	$(MAKE) frontend-test


####### DEPLOY ########

run:
	@set -e; \
	( cd backend && USE_SQLITE=1 DJANGO_ALLOWED_HOSTS=$(DJANGO_ALLOWED_HOSTS) DJANGO_CORS_ALLOWED_ORIGINS=$(DJANGO_CORS_ALLOWED_ORIGINS) USE_IN_MEMORY_CACHE=1 $(MANAGE) runserver $(BACKEND_HOST):$(BACKEND_PORT) ) & \
	BACK_PID=$$!; \
	( cd frontend && NEXT_PUBLIC_API_BASE_URL=$(PUBLIC_API_BASE_URL) ROBOTCLOUD_API_BASE_URL=$(PUBLIC_API_BASE_URL) HOST=$(FRONTEND_HOST) PORT=$(FRONTEND_PORT) npm run dev ) & \
	FRONT_PID=$$!; \
	trap 'kill $$BACK_PID $$FRONT_PID' INT TERM; \
	wait $$BACK_PID $$FRONT_PID

run-all:
	@set -e; \
	( cd backend && USE_SQLITE=1 DJANGO_ALLOWED_HOSTS=$(DJANGO_ALLOWED_HOSTS) DJANGO_CORS_ALLOWED_ORIGINS=$(DJANGO_CORS_ALLOWED_ORIGINS) USE_IN_MEMORY_CACHE=1 $(MANAGE) runserver $(BACKEND_HOST):$(BACKEND_PORT) ) & \
	BACK_PID=$$!; \
	( cd backend && USE_SQLITE=1 USE_IN_MEMORY_CACHE=1 $(MANAGE) run_scheduler ) & \
	SCHED_PID=$$!; \
	( cd frontend && NEXT_PUBLIC_API_BASE_URL=$(PUBLIC_API_BASE_URL) ROBOTCLOUD_API_BASE_URL=$(PUBLIC_API_BASE_URL) HOST=$(FRONTEND_HOST) PORT=$(FRONTEND_PORT) npm run dev ) & \
	FRONT_PID=$$!; \
	trap 'kill $$BACK_PID $$SCHED_PID $$FRONT_PID' INT TERM; \
	wait $$BACK_PID $$SCHED_PID $$FRONT_PID

scheduler:
	cd backend && USE_SQLITE=1 USE_IN_MEMORY_CACHE=1 $(MANAGE) run_scheduler

agent:
	cd backend && AGENT_PORT=$(AGENT_PORT) AGENT_IP=$(AGENT_IP) AGENT_NODE_NAME=$(AGENT_NODE_NAME) SCHEDULER_API_BASE_URL=$(SCHEDULER_API_BASE_URL) $(PYTHON) -m gpu_agent

agent-4090: agent
