{{- define "postgresql.name" -}}
{{- .Chart.Name -}}
{{- end -}}

{{/*
.Release is shared across the whole install (parent + every subchart),
so this produces the exact same hostname the parent chart's own
nexus-scheduler.databaseHost helper already expects when
postgresql.enabled is true — no change needed there.
*/}}
{{- define "postgresql.fullname" -}}
{{- .Release.Name -}}-postgresql
{{- end -}}

{{- define "postgresql.labels" -}}
app.kubernetes.io/name: {{ include "postgresql.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "postgresql.selectorLabels" -}}
app.kubernetes.io/name: {{ include "postgresql.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
