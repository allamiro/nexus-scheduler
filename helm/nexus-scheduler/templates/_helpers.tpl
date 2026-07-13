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
Builds DATABASE_URL from discrete pieces at pod-start time via
Kubernetes' own $(VAR_NAME) env-var substitution (resolved by the
kubelet, not a shell — the literal, unresolved text is all that ever
appears in `kubectl get pod -o yaml` or `helm template` output) rather
than requiring an operator to hand-compose and store a full connection
string. postgresql.auth.existingSecretName is the single source of truth
for these credentials, used both by the bundled subchart (when enabled)
to boot Postgres itself and by this app to build its own connection
string — one secret instead of two that had to be kept in sync manually.

CAVEAT: kubelet substitution does no URL-encoding — a username/password
containing URL-reserved characters (@ : / ? # %) will produce a broken
DATABASE_URL. Keep generated/chosen credentials free of those.
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
- name: DATABASE_URL
  value: "postgresql://$(DB_USER):$(DB_PASSWORD)@$(DB_HOST):$(DB_PORT)/$(DB_NAME)"
{{- end -}}

{{/* Same rationale and caveats as nexus-scheduler.databaseEnv above. */}}
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
- name: REDIS_URL
  value: "redis://:$(REDIS_PASSWORD)@$(REDIS_HOST):$(REDIS_PORT)"
{{- end -}}
