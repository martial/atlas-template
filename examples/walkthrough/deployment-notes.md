# Deployment notes
This is a fictional example for testing Atlas.
Cloud Run serves the application and MCP endpoint. Cloud Run Jobs perform indexing in the background.
Firestore in Datastore mode stores the catalogue and job state. Cloud Storage holds uploaded sources and vector snapshots.
The workspace has no sign-in. All visitors to its deployed URL share the same collection access.
