{{- define "nexus-scheduler.name" -}}
{{- .Chart.Name -}}
{{- end -}}

{{- define "nexus-scheduler.fullname" -}}
{{- .Release.Name -}}
{{- end -}}

{{- define "nexus-scheduler.labels" -}}
app.kubernetes.io/name: {{ include "nexus-scheduler.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "nexus-scheduler.selectorLabels" -}}
app.kubernetes.io/name: {{ include "nexus-scheduler.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "nexus-scheduler.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "nexus-scheduler.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "nexus-scheduler.databaseHost" -}}
{{- if .Values.postgresql.enabled -}}
{{ .Release.Name }}-postgresql
{{- else -}}
{{ .Values.externalDatabase.host }}
{{- end -}}
{{- end -}}

{{- define "nexus-scheduler.databasePort" -}}
{{- if .Values.postgresql.enabled -}}
5432
{{- else -}}
{{ .Values.externalDatabase.port }}
{{- end -}}
{{- end -}}

{{- define "nexus-scheduler.redisHost" -}}
{{- if .Values.redis.enabled -}}
{{ .Release.Name }}-redis
{{- else -}}
{{ .Values.externalRedis.host }}
{{- end -}}
{{- end -}}

{{- define "nexus-scheduler.redisPort" -}}
{{- if .Values.redis.enabled -}}
6379
{{- else -}}
{{ .Values.externalRedis.port }}
{{- end -}}
{{- end -}}

{{/*
Discrete Postgres connection pieces, sourced from
postgresql.auth.existingSecretName — the single source of truth for
these credentials, used both by the bundled subchart (when enabled) to
boot Postgres itself and by this app to build its own DATABASE_URL. Only
the pieces, not the assembled URL: building the URL via Kubernetes' own
$(VAR_NAME) substitution can't URL-encode, so a username/password
containing a URL-reserved character (@ : / ? # %) would silently produce
a broken connection string. Assembly instead happens in
nexus-scheduler.exportDatabaseUrlSnippet below, via Node's
encodeURIComponent, which handles that correctly.
*/}}
{{- define "nexus-scheduler.databaseEnv" -}}
- name: DB_USER
  valueFrom:
    secretKeyRef:
      name: {{ .Values.postgresql.auth.existingSecretName | quote }}
      key: username
- name: DB_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ .Values.postgresql.auth.existingSecretName | quote }}
      key: password
- name: DB_NAME
  valueFrom:
    secretKeyRef:
      name: {{ .Values.postgresql.auth.existingSecretName | quote }}
      key: database
- name: DB_HOST
  value: {{ include "nexus-scheduler.databaseHost" . | quote }}
- name: DB_PORT
  value: {{ include "nexus-scheduler.databasePort" . | quote }}
{{- end -}}

{{/* Same rationale as nexus-scheduler.databaseEnv above. */}}
{{- define "nexus-scheduler.redisEnv" -}}
- name: REDIS_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ .Values.redis.auth.existingSecretName | quote }}
      key: password
- name: REDIS_HOST
  value: {{ include "nexus-scheduler.redisHost" . | quote }}
- name: REDIS_PORT
  value: {{ include "nexus-scheduler.redisPort" . | quote }}
{{- end -}}

{{/*
A one-line `sh`-compatible statement that reads DB_USER/DB_PASSWORD/
DB_HOST/DB_PORT/DB_NAME (nexus-scheduler.databaseEnv above) and exports
a properly URL-encoded DATABASE_URL — unlike raw $(VAR_NAME)
substitution, encodeURIComponent correctly handles a username/password
containing URL-reserved characters. Meant to be the first line of a
container's `sh -c` command, before `exec`-ing the real entrypoint.
*/}}
{{- define "nexus-scheduler.exportDatabaseUrlSnippet" -}}
eval "$(node -e 'const e=encodeURIComponent;console.log("export DATABASE_URL="+JSON.stringify(`postgresql://${e(process.env.DB_USER)}:${e(process.env.DB_PASSWORD)}@${process.env.DB_HOST}:${process.env.DB_PORT}/${e(process.env.DB_NAME)}`))')"
{{- end -}}

{{/* Same rationale as nexus-scheduler.exportDatabaseUrlSnippet above. */}}
{{- define "nexus-scheduler.exportRedisUrlSnippet" -}}
eval "$(node -e 'const e=encodeURIComponent;console.log("export REDIS_URL="+JSON.stringify(`redis://:${e(process.env.REDIS_PASSWORD)}@${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`))')"
{{- end -}}
