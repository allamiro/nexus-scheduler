{{- define "redis.name" -}}
{{- .Chart.Name -}}
{{- end -}}

{{/*
.Release is shared across the whole install (parent + every subchart) —
the parent chart's nexus-scheduler.redisHost helper must match this
exactly (no replica/"-master" suffix, unlike the old Bitnami-based
convention, since this subchart has no replication concept).
*/}}
{{- define "redis.fullname" -}}
{{- .Release.Name -}}-redis
{{- end -}}

{{- define "redis.labels" -}}
app.kubernetes.io/name: {{ include "redis.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "redis.selectorLabels" -}}
app.kubernetes.io/name: {{ include "redis.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
