# Cloud Cost Analysis

## Initial estimate for fewer than 100 users

For an initial AWS deployment serving fewer than 100 users, the expected operating cost is approximately **$20–$30 per month**. A prudent maximum starting budget is **$50 per month** to accommodate heavier-than-expected AI usage.

| Component | Estimated monthly cost |
| --- | ---: |
| AWS Lightsail, 2 GB RAM | $12 |
| Storage and snapshots | $1–$4 |
| Supabase Free | $0 |
| Cloudflare Free | $0 |
| OpenAI API | $5–$20 |
| **Estimated total** | **$18–$36/month** |

## Recommended initial configuration

- Run the promotional website and golf game on one **AWS Lightsail 2 GB Linux server**.
- Package the application as a container so it can be moved to another AWS service or Azure later.
- Continue using **Supabase Free** for authentication and account services while usage remains small.
- Continue using **Cloudflare Free** for DNS, HTTPS, and public routing.
- Use the **OpenAI API** for AI Caddie advice; do not install Ollama or provision a GPU in AWS.
- Store the OpenAI API key only on the server in a protected environment variable or cloud secret—not in browser code.
- Keep the deterministic golf engine responsible for shot results, distances, risk, scoring, and strategy calculations. OpenAI should explain and enrich those results rather than control them.

## AWS hosting

The AWS Lightsail 2 GB plan is currently $12 per month and includes:

- 2 vCPUs
- 2 GB RAM
- 60 GB SSD storage
- 3 TB monthly transfer
- A public IPv4 address

If the game needs more memory, the 4 GB plan is $24 per month. The 2 GB plan should be the starting point; increase it only after monitoring actual memory and CPU usage.

AWS pricing reference: <https://aws.amazon.com/lightsail/pricing/>

## OpenAI usage

Start with a cost-efficient model suitable for concise, well-defined golf analysis. At the time of this estimate, `gpt-5.4-mini` costs:

- $0.75 per one million input tokens
- $0.075 per one million cached input tokens
- $4.50 per one million output tokens

For fewer than 100 users, compact prompts and short responses should keep initial OpenAI usage around **$5–$20 per month**. Actual cost depends more on rounds played and AI calls per round than on the number of registered accounts.

Controls to implement:

- Set an initial OpenAI monthly spending allowance of **$15**.
- Keep prompts focused and avoid sending unnecessary round history with every request.
- Limit response length.
- Generate AI insight only where it adds instructional value.
- Record token usage, response latency, model name, and prompt version.
- Preserve the deterministic fallback when AI is unavailable or a request times out.

Official OpenAI pricing reference: <https://developers.openai.com/api/docs/models/gpt-5.4-mini>

## Supabase

The Supabase Free plan is sufficient for the initial user count. It currently includes up to 50,000 monthly active users, but it does not include automatic backups and may pause after one week without activity.

When the game becomes a public production service, Supabase Pro is a sensible upgrade and would add approximately **$25 per month**. That would bring the likely total to approximately **$45–$65 per month**, depending on server size and OpenAI usage.

Supabase pricing reference: <https://supabase.com/pricing>

## Budget safeguards

- Create an AWS budget warning at **$30 per month**.
- Create a second urgent AWS warning at **$50 per month**.
- Set an OpenAI usage limit or alert near **$15 per month** initially.
- Review AI token usage after the first 10–20 real users complete rounds.
- Monitor server CPU and memory before moving from the $12 plan to the $24 plan.

## Upgrade path

The initial Lightsail deployment is intended to be inexpensive and simple. When traffic or reliability requirements increase, the containerized application can move to AWS managed compute, PostgreSQL can move to RDS, and course assets can move to S3 without redesigning the golf engine.

The managed architecture will cost more—typically **$55–$100 or more per month**—because compute, a load balancer, managed PostgreSQL, storage, logging, and AI usage are billed separately. It is unnecessary for the initial group of fewer than 100 users.

## Recommendation

Launch with:

- $12/month Lightsail server
- Supabase Free
- Cloudflare Free
- Approximately $15/month OpenAI allowance
- $30 AWS warning and $50 maximum-budget warning

The practical starting expectation is **$20–$30 per month**, with **$50 per month** reserved as a safe upper operating budget.
