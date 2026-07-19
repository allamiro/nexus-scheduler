# helm/ocr — the airgapped OCR pipeline chart

The OCR service (Docling + Tesseract + OCRmyPDF behind a
Mistral-OCR-compatible API, `docker/ocr/`) as an independent Helm
install. It has two consumers, and this page is the wiring guide for
both — including the common case where **LibreChat + LiteLLM (the
`helm/test-ai` chart) is already running** with Keycloak and friends,
and you are bringing `helm/nexus-scheduler` and this chart into that
cluster and connecting the three.

```
helm/nexus-scheduler          helm/ocr                helm/test-ai
┌───────────────┐   HTTP    ┌───────────┐   HTTP    ┌───────────────┐
│ worker ───────┼──────────▶│ ocr :4200 │◀──────────┼─── librechat   │
│ (job          │           │           │           │ (chat uploads, │
│  attachments) │           │  /v1/...  │──────────▶│    litellm     │
└───────────────┘           └───────────┘  vision   │    :4000)      │
                             (optional descriptions)└───────────────┘
```

The three charts are deliberately independent installs — separate
namespaces, separate lifecycles. Nothing here templates across
releases; every connection is a values-level URL plus a NetworkPolicy
peer, so each side can be upgraded or replaced alone.

## 0. Build and stage the image (airgap first)

The OCR image is **not published anywhere** — build it from the repo
root and put it wherever your cluster pulls from:

```bash
docker build -f docker/ocr/Dockerfile -t nexus-scheduler-ocr:<tag> .

# Connected registry:
docker tag nexus-scheduler-ocr:<tag> registry.example.internal/nexus-scheduler-ocr:<tag>
docker push registry.example.internal/nexus-scheduler-ocr:<tag>

# True airgap — file transfer instead of a push:
docker save nexus-scheduler-ocr:<tag> -o nexus-scheduler-ocr.tar
# ...carry the tar across, then on the inside:
docker load -i nexus-scheduler-ocr.tar   # or: kind load image-archive / ctr images import
```

Then in values: `global.imageRegistry`, `image.repository`,
`image.tag` — and pin `image.digest` in a mirrored-registry
environment (digest takes precedence over tag).

All OCR/ML dependencies (Docling models, Tesseract data, OCRmyPDF)
are baked into the image at **build** time; the pod makes no build- or
run-time downloads. The chart has no subchart or external chart
dependencies. That is the airgap contract: if the image is present,
the chart works.

## 1. Install the chart

```bash
kubectl create namespace ocr
helm install nexus-ocr helm/ocr -n ocr -f my-ocr-values.yaml
```

Naming matters: the Service is named after the **release**
(`nexus-ocr` above), so that's the hostname the other two charts dial.
Port is always `4200`.

Non-negotiables enforced at render time:

- `replicas` must be 1 — the Mistral files API keeps per-pod state; a
  second replica would 404 half the signed-URL lookups.
- `fileStoreMaxBytes` ≥ 15 MiB (the per-file limit).
- `gateway.*` is all-or-nothing (see §4).

## 2. Wire the scheduler's worker to OCR

In **helm/nexus-scheduler** values:

```yaml
ocr:
  serviceUrl: "http://nexus-ocr.ocr.svc:4200"   # no /v1 here
  describeImages: "false"                        # "true" needs §4
```

In **this chart's** values, admit the worker through the
NetworkPolicy (default posture is deny-all):

```yaml
networkPolicy:
  clientPeers:
    - name: worker
      namespaces: [nexus-scheduler]        # the app chart's namespace
      podMatchLabels:
        app.kubernetes.io/name: nexus-scheduler
        app.kubernetes.io/component: worker
```

Left unwired (`ocr.serviceUrl` empty), jobs with attachments still run
— extraction is skipped with a warning per run.

## 3. Wire LibreChat chat uploads to OCR

In **helm/test-ai** values:

```yaml
librechat:
  ocr:
    baseUrl: "http://nexus-ocr.ocr.svc:4200/v1"   # /v1 required here
```

(LibreChat speaks the Mistral OCR wire format — `strategy:
mistral_ocr` with a `baseURL` — because that is the strategy this
LibreChat build actually implements; `custom_ocr` parses but does
nothing. The "signed URL" the service returns is a `data:` URL, so no
network fetch ever happens. The apiKey is a placeholder by design —
isolation is the NetworkPolicy, not a credential.)

And admit LibreChat here, alongside the worker peer:

```yaml
networkPolicy:
  clientPeers:
    - name: worker
      namespaces: [nexus-scheduler]
      podMatchLabels:
        app.kubernetes.io/name: nexus-scheduler
        app.kubernetes.io/component: worker
    - name: librechat
      namespaces: [test-ai]
      podMatchLabels:
        app.kubernetes.io/name: librechat
```

Keep LibreChat's `fileConfig` limits aligned with this service: 10
files, 15 MB each, 50 MB per message (the test-ai defaults).

In the chat UI: attach a file, pick **"Upload as Text"** — the
extracted markdown enters the conversation context, so any text model
can answer about the document.

## 4. Optional: vision descriptions of image inputs (issue #145)

`describeImages` / `OCR_DESCRIBE_IMAGES` sends image attachments to a
**multimodal** model for a one-paragraph description that is appended
to the extracted text. The trap to avoid: the default model set
(gemma3:1b, codegemma:2b, phi4-mini-reasoning) is **text-only**.
Pointing the gateway at a text model doesn't fail loudly — descriptions
are best-effort, so you get silently missing descriptions and LiteLLM
400s in the logs. This chart therefore refuses a partial gateway
config at render time.

Three steps, all or nothing:

1. **Add a multimodal model to the test-ai catalogue** (values):

   ```yaml
   models:
     # ...existing text models...
     - name: moondream:1.8b        # small vision model, ~1.7 GB
       ollamaModel: moondream:1.8b # (llava:7b is the larger alternative)
       pull: true
   ```

   Airgap note: the test-ai pull Job fetches models from the Ollama
   registry. In an airgapped cluster, pre-seed the Ollama volume
   instead: on a connected machine `ollama pull moondream:1.8b`, then
   copy `~/.ollama/models` into the PVC (the blobs are
   content-addressed files; a tar over the wire works).

2. **Create the gateway key Secret** in this chart's namespace — key
   `apiKey`, value a LiteLLM virtual key (an `llm_api` key is enough):

   ```bash
   kubectl -n ocr create secret generic ocr-gateway-key \
     --from-literal=apiKey=<litellm-virtual-key>
   ```

3. **Point this chart at the gateway** (values):

   ```yaml
   gateway:
     url: "http://litellm.test-ai.svc:4000"
     visionModel: "moondream:1.8b"
     existingSecret: "ocr-gateway-key"
     egress:
       podMatchLabels:
         app.kubernetes.io/name: litellm
       namespaceMatchLabels:
         kubernetes.io/metadata.name: test-ai
       port: 4000
   ```

   The egress block must describe the pods `gateway.url` actually
   resolves to — a NetworkPolicy cannot derive a selector from a URL.

Then set `ocr.describeImages: "true"` in the nexus-scheduler chart
(and/or `OCR_DESCRIBE_IMAGES=true` in Compose).

## 5. Observability

The pod carries `prometheus.io/scrape` annotations
(`metrics.annotations`) for the observability chart's annotation-driven
discovery. Scrapers get their own NetworkPolicy lane:

```yaml
metrics:
  scraperNamespaces: [observability]   # NOT networkPolicy.clientNamespaces
```

## 6. Verify the wiring

```bash
# 1. The service is up:
kubectl -n ocr get pods,svc

# 2. Worker path: create a job with an attachment in Nexus Scheduler,
#    run it, and check the run output includes the extracted text.
#    An ocr.serviceUrl miswire shows as a per-run extraction warning.

# 3. LibreChat path: in the chat UI attach a PDF, choose "Upload as
#    Text", and ask a question only the document can answer.

# 4. Vision path (if enabled): upload a photo/diagram the same way —
#    the extracted text ends with a model-written description. If
#    descriptions are missing, check LiteLLM logs for 400s (wrong or
#    text-only visionModel) and this pod's logs for gateway errors.

# 5. NetworkPolicy is actually enforcing (requires a CNI that does):
kubectl -n ocr run probe --rm -it --image=busybox --restart=Never \
  -- wget -qO- --timeout=3 http://nexus-ocr:4200/healthz && echo LEAK
# ^ must TIME OUT from an unlabelled pod; only worker/librechat peers get through.
```

## Compose parity

The Compose stack wires all of this in `docker-compose.yml` +
`docker/librechat/librechat.yaml` + `docker/litellm/config.yaml`, with
the same knobs as env vars: `OCR_FILE_STORE_MAX_BYTES`,
`OCR_EXTRACTED_TEXT_MAX_CHARS`, `OCR_DESCRIBE_IMAGES`,
`OCR_VISION_MODEL`, `OLLAMA_PULL_MODELS` (see `.env.example`). Keep the
two in sync — the compose/chart parity guard (issue #149) exists
because they drift.
