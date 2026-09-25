# Golf Intelligence usage notes

Golf Intelligence is an import-time course-data provider. The Course Mapper
backend may use it to search for one requested facility and retrieve one selected
course group. Published gameplay reads only locally normalized Jetta course data
and never calls the provider.

Operational safeguards:

- Credentials and bearer tokens remain on the server.
- Course search is free; no search result is hydrated automatically.
- Paid calls start disabled after every server restart.
- A developer must enable paid calls and confirm the selected course download.
- A valid per-course cache is reused instead of repeating a paid request.
- Do not scrape, crawl, mirror, resell, train on, or build RAG indexes from the
  provider catalog or course payloads.
- Confirm the applicable personal or multi-user license before distributing
  provider-derived course data to other golfers.

Current provider references:

- [First API calls and authentication](https://golfintelligence.com/docs/)
- [API pricing and cache guidance](https://golfintelligence.com/api-pricing/)
- [Swagger API](https://api.golfintelligence.com/swagger/index.html)
- [Terms of Use](https://golfintelligence.com/terms/)

Provider pricing and terms may change. The editor's estimated credit label is a
server-side configuration value, not a guarantee of current provider pricing.
