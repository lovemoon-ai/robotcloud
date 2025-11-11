.PHONY: test run scheduler agent backend-deps frontend-test invite-codes kill

PYTHON := $(CURDIR)/.venv/bin/python
PIP := $(CURDIR)/.venv/bin/pip
MANAGE := $(PYTHON) manage.py

####### DEVELOP ########

backend-deps:
	$(PIP) install -r backend/requirements-dev.txt
	cd backend && $(PIP) install -e ".[all]"

front-deps:
	cd frontend && npm install

frontend-test:
	cd frontend && npm test

INVITE_ARGS ?= list

invite-codes:
	cd backend && INVITE_USE_SQLITE=1 $(PYTHON) -m tools.invite_codes $(INVITE_ARGS)

KILL_PORTS := 8000 3000 8001

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
DJANGO_ALLOWED_HOSTS="localhost,127.0.0.1,100.72.232.210"

run:
	@set -e; \
	( cd backend && USE_SQLITE=1 DJANGO_ALLOWED_HOSTS=$(DJANGO_ALLOWED_HOSTS) USE_IN_MEMORY_CACHE=1 $(MANAGE) runserver 0.0.0.0:8000 ) & \
	BACK_PID=$$!; \
	( cd frontend && NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1 npm run dev ) & \
	FRONT_PID=$$!; \
	trap 'kill $$BACK_PID $$FRONT_PID' INT TERM; \
	wait $$BACK_PID $$FRONT_PID

run-all:
	@set -e; \
	( cd backend && USE_SQLITE=1 DJANGO_ALLOWED_HOSTS=$(DJANGO_ALLOWED_HOSTS) USE_IN_MEMORY_CACHE=1 $(MANAGE) runserver 0.0.0.0:8000 ) & \
	BACK_PID=$$!; \
	( cd backend && USE_SQLITE=1 USE_IN_MEMORY_CACHE=1 $(MANAGE) run_scheduler ) & \
	SCHED_PID=$$!; \
	( cd frontend && NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1 npm run dev ) & \
	FRONT_PID=$$!; \
	trap 'kill $$BACK_PID $$SCHED_PID $$FRONT_PID' INT TERM; \
	wait $$BACK_PID $$SCHED_PID $$FRONT_PID

scheduler:
	cd backend && USE_SQLITE=1 USE_IN_MEMORY_CACHE=1 $(MANAGE) run_scheduler

agent:
	cd backend && AGENT_PORT=8001 SCHEDULER_API_BASE_URL=http://localhost:8000/api/v1 $(PYTHON) -m gpu_agent

agent-4090:
	export SCHEDULER_API_BASE_URL=http://100.72.232.210:8000/api/v1 \
	export AGENT_IP=100.72.208.174 \
	export AGENT_PORT=8001 \
	export AGENT_NODE_NAME=4090-01 \
	cd backend && $(PYTHON) -m gpu_agent
