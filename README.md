# Nordvolt EL – GitHub Pages + Cloudflare Worker

## Klar til at uploade til GitHub Pages
Upload **indholdet af denne mappe** til roden af et GitHub-repository (index.html skal ligge i roden). Gå til **Settings → Pages → Deploy from a branch → main / (root) → Save**. Besøg den adresse GitHub viser efter publicering. Hash-navigation (`#/ladestandere` osv.) virker på GitHub Pages. Hvis du bruger eget domæne, vælg det under Pages/Custom domain og opsæt DNS hos din domæneudbyder.

Frontend (forside, ladestandere, elarbejde, produktoversigt, billeder, prisberegner) virker straks. **Indhent tilbud sender ikke før Worker er sat op**, og vil vise en klar fejl frem for at love kunden, at forespørgslen er modtaget.

## Aktivér tilbud/SMS/e-mail
1. Opret en Cloudflare-konto og en Worker (Cloudflare Dashboard → Workers & Pages). Du kan bruge Wrangler CLI: `npx wrangler login` og `npx wrangler deploy` i `cloudflare-worker` efter at have kopieret `wrangler.toml.example` til `wrangler.toml`.
2. Opret en **Workers KV namespace** i Cloudflare → Storage & databases → KV. Kopiér dens ID ind i `cloudflare-worker/wrangler.toml` under binding `LEADS_KV`. Det opbevarer tilbud i **90 dage**. Overvej længere opbevaring, backup og passende persondatapolitik.
3. I `[vars]` i `wrangler.toml`: erstat `https://DITBRUGERNAVN.github.io` med sidens **origin** (f.eks. `https://minkonto.github.io`, eller `https://nordvolt-el.dk` når du har eget domæne). **Ingen sti eller afsluttende skråstreg!** Til flere domæner kan du adskille dem med komma.
4. Angiv **hemmeligheder** via `npx wrangler secret put NAVN` inde i `cloudflare-worker` (eller via Dashboard → Worker → Settings → Variables and Secrets):
   - `RESEND_API_KEY`: Resend API-nøgle
   - `LEADS_NOTIFY_TO`: mailadressen der skal modtage tilbud, f.eks. `tilbud@ditdomaene.dk`
   - `LEADS_FROM`: verificeret afsender, f.eks. `Nordvolt EL <notifikation@ditdomaene.dk>`
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`: Twilio SMS-konto og et nummer der må sende til danske numre
   - `LEADS_SMS_TO`: SMS-modtagernummer, f.eks. `+4512345678`
5. Deploy Worker. Kopiér dens `https://...workers.dev`-adresse og indsæt den i **`config.js`** som `workerUrl: 'https://...'` (ingen `/api/leads` til sidst). Commit/opdater filen på GitHub.
6. Test med en rigtig formular på GitHub Pages. Tjek begge notifikationer og at du kan se tilbuddet i Workers KV. Resend kræver normalt et verificeret afsenderdomæne; Twilio kræver gyldig konto, korrekt afsender og eventuelt godkendt destination. Tjenesterne kan koste penge.

## Vigtigt om drift og sikkerhed
- **Du må aldrig uploade dine API-nøgler** i `config.js`, `app.js`, GitHub-repo eller `wrangler.toml`. Brug Worker Secrets.
- GitHub Pages kører kun frontend. SMS og mail kræver en separat Worker og konti. Efter gyldig indsendelse gemmer Worker forespørgslen i KV **før** den sender svar til kunden. Notifikationer forsøges sendt asynkront, og kan fejle; tjek KV og Cloudflare logs ved problemer. Dette er ikke en garanti for SMS/mail-levering.
- Offentlige formularer kan rammes af spam. Til produktion bør du aktivere Cloudflare Turnstile, overvågning og passende rate-limiting. Opret en rutine for databeskyttelse, sletning af kundedata og backup. Worker-koden gemmer personoplysninger i KV i 90 dage og har ingen offentlig læse-API.
- Alle serviceillustrationer i `images/` kan udskiftes med egne billeder. Ændr filstier i `app.js` under `const photos`.
- Prisberegneren viser **tillæg/materialeoverslag**, ikke samlet pris inkl. ladestander og montering.
- `kontakt@nordvolt-el.dk` i siden er en eksempeladresse – udskift den, hvis I bruger en anden adresse.

## Lokal test
Du kan åbne `index.html` lokalt og afprøve designet, men indsendelse via Worker fra en `file://`-adresse er ikke tilladt pga. origin-kontrollen. Test reelle forespørgsler fra GitHub Pages-domænet.
