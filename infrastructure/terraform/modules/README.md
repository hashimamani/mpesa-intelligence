Shared Terraform modules (`vpc`, `database`, `compute`, `storage`, `queues`,
`secrets`, `monitoring`, ...) are added here at Stage 15, parameterized so
`environments/{staging,production}` instantiate them consistently instead of
duplicating resource definitions per environment.
