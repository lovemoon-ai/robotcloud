#!/usr/bin/env sh

_curfile=$(realpath $0)
cur=$(dirname $_curfile)

export ROBOTCLOUD_API_BASE=https://robotcloud.conductor-ai.top/api/v1
TOKEN_FILE="$cur/.token"

prompt-phone() {
    if [ -n "$PHONE" ]; then
        printf "Phone [%s]: " "$PHONE"
        read -r input_phone
        if [ -n "$input_phone" ]; then
            PHONE="$input_phone"
        fi
    else
        printf "Phone: "
        read -r PHONE
    fi
    if [ -z "$PHONE" ]; then
        echo "PHONE is required" >&2
        return 1
    fi
    export PHONE
}

prompt-code() {
    printf "SMS code: "
    read -r CODE
    if [ -z "$CODE" ]; then
        echo "CODE is required" >&2
        return 1
    fi
}

load-token() {
    if [ ! -f "$TOKEN_FILE" ]; then
        echo "Token file not found: $TOKEN_FILE. Run get-token first." >&2
        return 1
    fi
    ROBOTCLOUD_TOKEN=$(sed -n '1p' "$TOKEN_FILE")
    if [ -z "$ROBOTCLOUD_TOKEN" ]; then
        echo "Token file is empty: $TOKEN_FILE. Run get-token again." >&2
        return 1
    fi
    export ROBOTCLOUD_TOKEN
}

save-token() {
    if [ -z "$ROBOTCLOUD_TOKEN" ]; then
        echo "ROBOTCLOUD_TOKEN is empty" >&2
        return 1
    fi
    old_umask=$(umask)
    umask 077
    printf "%s\n" "$ROBOTCLOUD_TOKEN" > "$TOKEN_FILE"
    umask "$old_umask"
    chmod 600 "$TOKEN_FILE" 2>/dev/null || true
    echo "Token saved to $TOKEN_FILE"
}

send-code () {
    prompt-phone || return 1
    curl -sS -X POST "$ROBOTCLOUD_API_BASE/auth/send_code" \
      -H "Content-Type: application/json" \
      -d "{\"phone\":\"$PHONE\"}"
}

get-token() {
    prompt-phone || return 1
    prompt-code || return 1
    ROBOTCLOUD_TOKEN=$(
      curl -sS -X POST "$ROBOTCLOUD_API_BASE/auth/login_code" \
        -H "Content-Type: application/json" \
        -d "{
          \"phone\":\"$PHONE\",
          \"code\":\"$CODE\",
          \"device_id\":\"robotcloud-cli\",
          \"device_type\":\"desktop\",
          \"replace_existing_device\":true
        }" | jq -r '.data.token'
    )
    if [ -z "$ROBOTCLOUD_TOKEN" ] || [ "$ROBOTCLOUD_TOKEN" = "null" ]; then
        echo "Failed to get token" >&2
        return 1
    fi
    export ROBOTCLOUD_TOKEN
    save-token
}

upload-dataset() {
    if [ -z "$1" ]; then
        echo "Usage: upload-dataset [path to dataset zip]" >&2
        return 1
    fi
    load-token || return 1
    cd "$cur/../../backend" && \
    uv run python ../scripts/manual-upload/upload_dataset.py "$1" \
      --api-base "$ROBOTCLOUD_API_BASE" \
      --token "$ROBOTCLOUD_TOKEN" \
      --name so101-demo \
      --visibility public
    cd -
}

import-dataset-h20() {
    if [ -z "$1" ]; then
        echo "Usage: import-dataset-h20 [local path to dataset zip on h20]" >&2
        return 1
    fi
    load-token || return 1
    cd "$cur/../../backend" && \
    uv run python ../scripts/manual-upload/import_agent_dataset.py "$1" \
        --api-base "$ROBOTCLOUD_API_BASE" \
        --token "$ROBOTCLOUD_TOKEN" \
        --target-node h20 \
        --name "$2" \
        --visibility public
    cd -
}

echo ">> send-code"
echo ">> get-token"
echo ">> upload-dataset [path to dataset zip]"
echo ">> import-dataset-h20 [local path to dataset zip on h20] [dataset name]"
