## TODO

- Implement a turnkey scheduler + GPU agent workflow so training tasks move automatically (scripted startup or container orchestration).
- Replace manual `dataset_id` entry on the training page with a dataset selector that consumes `/dataset/list`.
- Provide training log access (backend download/preview endpoint and agent log writers, frontend viewer).
- Enhance job feedback beyond polling (e.g., shorter active intervals or SSE/WebSocket notifications).
- Expose dataset file access with proper authorization so uploaded samples can be browsed or downloaded.
