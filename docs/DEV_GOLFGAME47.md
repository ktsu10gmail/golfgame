# Dev Golfgame on .47

Open http://192.168.1.47:8080/ on the LAN. Mapper remains at http://192.168.1.47:8081/editor.html.

The game displays Development .47 and uses the same Supabase project as .15 for identity. Sign in with your existing account. Local player profiles, rounds, licensing records, course installations, and Mapper data remain under /home/ksu/mapper47/app, independently of .15. Local coach access and licensing records are not copied from .15.

Shared provider settings are mastered privately in /home/ksu/.config/jetta/providers.env. Host settings remain in the application .env. Email delivery and the paid golf provider stay disabled; license enforcement stays in shadow mode. The Gemini provider/model match .15 using the shared key.

The backend user service jetta-mapper47-backend binds port 8080 on LAN interfaces. The editor service remains on 8081. Both restart automatically. Deployment targets use configuration so .15 can later move to a cloud address without changing game logic. This is a LAN development setup, not an internet deployment.

Verification: LAN HTTP responses, live Supabase auth settings, and browser login rendering passed. Complete the owner check by signing in, selecting a course, playing and resuming a round, and checking coach features with a locally authorized coach account. New-account confirmation/password recovery may require adding http://192.168.1.47:8080/ to the Supabase Auth redirect allowlist. Existing password sign-in does not require that redirect.

Mapper currently installs locally into this Dev game. Explicit Dev/Prod installation selection is the next separate implementation step. .15 Mapper remains the stable fallback.
