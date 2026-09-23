# Definiční specifikace -- Production Efficiency Dashboard

**Pracovní název projektu:** `Production Efficiency Dashboard`\
**Účel dokumentu:** Kompletní zadání pro implementaci aplikace v Codexu\
**Verze:** 0.1 -- MVP / architektonický základ\
**Datum:** 2026-09-23

------------------------------------------------------------------------

## 1. Cíl projektu

Vytvoř webovou aplikaci pro **živé sledování efektivity výroby přímo na
výrobních linkách**.

Aplikace má vizuálně vycházet z principu shop-floor dashboardů typu
Shoplogix, ale **nesmí být kopií jejich UI**. Má vytvořit vlastní,
moderní a velmi dobře čitelný výrobní dashboard optimalizovaný pro velký
monitor/TV.

Hlavním prvkem obrazovky bude **hodinový rozpad aktuální směny**.

Pro každou hodinu směny se zobrazí jeden **horizontální stacked bar**,
který rozdělí danou hodinu na jednotlivé výrobní ztráty a efektivní
výrobu.

Příklad osmihodinové směny:

``` text
06:00–07:00  ████████████████████████████████████████████████
07:00–08:00  ████████████████████████████████████████████████
08:00–09:00  ████████████████████████████████████████████████
09:00–10:00  ████████████████████████████████████████████████
10:00–11:00  ████████████████████████████████████████████████
11:00–12:00  ████████████████████████████████████████████████
12:00–13:00  ████████████████████████████████████████████████
13:00–14:00  ████████████████████████████████████████████████
```

Každý řádek představuje maximálně 60 minut a skládá se například z:

-   GOOD PRODUCTION / efektivní výroba
-   SPEED LOSS / slow running
-   DOWNTIME / nevýroba a prostoje
-   SCRAP LOSS / ztráta způsobená zmetkovitostí
-   případně UNPLANNED / UNKNOWN, pokud data nelze jednoznačně zařadit

Dashboard musí během směny průběžně aktualizovat aktuální hodinu.

Pod hodinovým pohledem bude **souhrn celé směny** s hlavními KPI.

------------------------------------------------------------------------

## 2. Kontext a zdroj dat

Ve výrobním závodě již existuje MES **CISE Ciclades**.

Ciclades sbírá data ze strojů a ukládá informace potřebné pro tento
dashboard. K dispozici je přímý SQL přístup do databáze Ciclades.

Předpokládaný databázový systém zdroje:

-   Microsoft SQL Server

Aplikace musí být navržena tak, aby připojení ke zdrojovému MES bylo
oddělené pomocí datového adaptéru/repository vrstvy. Nesmí být business
logika natvrdo svázaná s konkrétními názvy tabulek Ciclades.

Implementuj například:

``` text
MesDataProvider
    └── CicladesSqlServerProvider
```

Později musí být možné doplnit jiný zdroj bez přepisování výpočtového
jádra.

Z Ciclades očekáváme minimálně:

-   seznam strojů / linek
-   aktuální výrobní zakázku
-   výrobek / reference
-   časové značky
-   počty vyrobených kusů
-   GOOD kusy
-   NOK / scrap kusy
-   cykly
-   skutečný cycle time
-   target / ideal cycle time, pokud je dostupný
-   prostoje
-   začátek a konec prostojů
-   důvody prostojů, pokud jsou dostupné
-   stav stroje, pokud je dostupný
-   směnové údaje, pokud jsou dostupné

Konkrétní SQL schéma zatím není známé.

**Nevymýšlej názvy Ciclades tabulek a sloupců.**

Připrav rozhraní, mock data a konfigurační místo, kam bude následně
doplněn skutečný SQL mapping.

------------------------------------------------------------------------

## 3. Architektura

Použij tuto základní architekturu:

``` text
                        ┌────────────────────────┐
                        │     Ciclades MES       │
                        │   Microsoft SQL Server │
                        └───────────┬────────────┘
                                    │ read-only
                                    ▼
                        ┌────────────────────────┐
                        │       Backend API      │
                        │        FastAPI         │
                        │                        │
                        │ MES Adapter            │
                        │ KPI Engine             │
                        │ Shift Engine           │
                        │ Display Configuration  │
                        └───────────┬────────────┘
                                    │
                           PostgreSQL
                          configuration
                                    │
                                    ▼
                        ┌────────────────────────┐
                        │ React + TypeScript     │
                        │ Vite                   │
                        │ Production Dashboard   │
                        └───────────┬────────────┘
                                    │
                 ┌──────────────────┴──────────────────┐
                 ▼                                     ▼
       Raspberry Pi Zero 2 W                   Windows PC / Stick
       Chromium kiosk mode                     Chromium / Edge kiosk
```

### Backend

Použij:

-   Python 3
-   FastAPI
-   SQLAlchemy
-   Pydantic
-   Alembic
-   PostgreSQL driver
-   Microsoft SQL Server driver vhodný pro Linux Docker container

Backend musí být stateless všude, kde je to praktické.

### Frontend

Použij:

-   React
-   TypeScript
-   Vite
-   lehké CSS řešení
-   SVG/CSS pro jednoduché grafy, pokud to bude praktičtější než těžká
    chart knihovna

Frontend musí být optimalizovaný i pro:

**Raspberry Pi Zero 2 W / 512 MB RAM.**

Proto:

-   minimum JavaScript bundle
-   žádné těžké animace
-   žádné 3D efekty
-   minimum závislostí
-   žádný zbytečný UI framework
-   grafy musí být jednoduché a rychlé
-   po načtení nesmí docházet k memory leakům
-   dashboard musí bez problémů běžet nepřetržitě několik dní

### Databáze aplikace

Použij **PostgreSQL**.

Pro MVP nepoužívej TimescaleDB.

Ciclades zůstává zdrojem výrobních historických dat. PostgreSQL této
aplikace slouží primárně pro:

-   konfiguraci
-   dashboard displays
-   směny
-   stroje a jejich mapování
-   target cycle times, pokud nejsou v MES
-   barevné / zobrazovací nastavení
-   případné manuální override
-   heartbeat zobrazovacích terminálů
-   audit změn konfigurace

Neduplikuj bez důvodu kompletní výrobní historii z Ciclades.

------------------------------------------------------------------------

## 4. Docker

Celá aplikace musí běžet v Dockeru na Ubuntu VM.

Použij `docker compose`.

Minimální služby:

``` yaml
services:
  frontend:
  backend:
  postgres:
```

Volitelně připrav architekturu pro pozdější:

``` yaml
  nginx:
  redis:
```

Redis ale **není pro MVP povinný**.

Repozitář navrhni například:

``` text
production-dashboard/
├── README.md
├── docker-compose.yml
├── .env.example
├── backend/
│   ├── Dockerfile
│   ├── app/
│   │   ├── api/
│   │   ├── core/
│   │   ├── db/
│   │   ├── mes/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   └── main.py
│   └── tests/
├── frontend/
│   ├── Dockerfile
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── api/
│   │   ├── hooks/
│   │   ├── types/
│   │   └── styles/
│   └── ...
└── docs/
    ├── architecture.md
    └── ciclades-mapping.md
```

Veškeré credentials pouze přes environment variables / secrets.

Nikdy je necommituj do Gitu.

------------------------------------------------------------------------

## 5. Zobrazovací terminály

Dashboard bude zobrazován na monitorech ve výrobě.

Klient může být:

-   Raspberry Pi Zero 2 W
-   Raspberry Pi vyšší řady
-   Windows PC
-   Windows compute stick

Terminál nesmí potřebovat lokální konfiguraci konkrétní linky.

Použij koncept **Display ID**.

Například:

``` text
https://dashboard.factory.local/display/07
```

Server ví:

``` text
Display 07
→ Plant: CZ01
→ Area: Injection
→ Line: Machine 92
→ Dashboard type: production-efficiency
```

Administrátor může mapping změnit na serveru.

Po refreshi se terminál automaticky přepne na novou konfiguraci.

### Display heartbeat

Každý otevřený dashboard bude pravidelně posílat heartbeat.

Ukládej:

-   display ID
-   last seen
-   IP pokud je vhodné a povolené
-   browser / client info
-   aktuálně zobrazovanou linku
-   verzi frontendu

Administrace musí později umožnit vidět:

``` text
DISPLAY-01    ONLINE
DISPLAY-02    ONLINE
DISPLAY-03    OFFLINE – last seen 08:34
```

------------------------------------------------------------------------

## 6. Kiosk režim

Raspberry Pi bude sloužit pouze jako zobrazovací zařízení.

Po bootu:

1.  nabootuje Linux
2.  automaticky přihlásí kiosk uživatele
3.  spustí Chromium
4.  otevře URL konkrétního Display ID
5.  Chromium běží fullscreen bez ovládacích prvků
6.  pokud aplikace nebo browser spadne, musí se automaticky obnovit

Připrav v `docs/` také příklad konfigurace Raspberry Pi kiosk klienta.

Kiosk klient ale není součást backend Docker stacku.

------------------------------------------------------------------------

## 7. Směny

Aplikace musí podporovat konfigurovatelné směny.

Výchozí příklad:

``` text
Ranní       06:00–14:00
Odpolední   14:00–22:00
Noční       22:00–06:00
```

Nepředpokládej natvrdo 8 hodin.

Směna může mít jinou délku.

Noční směna musí správně fungovat přes půlnoc.

Každá směna se automaticky rozdělí na hodinové intervaly.

Například:

``` text
06:00–07:00
07:00–08:00
...
13:00–14:00
```

Pokud směna nezačíná v celou hodinu, musí fungovat například:

``` text
06:30–07:30
07:30–08:30
...
```

------------------------------------------------------------------------

## 8. Výpočtový model

Výpočty musí být oddělené od UI.

Vytvoř samostatný **KPI / Loss Engine**.

Pro každý hodinový interval vypočítej časový rozpad.

Základní myšlenka:

``` text
AVAILABLE TIME
    ├── GOOD PRODUCTION TIME
    ├── SPEED LOSS
    ├── SCRAP LOSS
    └── DOWNTIME
```

Součet musí odpovídat délce sledovaného intervalu.

Pro dokončenou hodinu:

``` text
GOOD + SPEED LOSS + SCRAP LOSS + DOWNTIME = 60 min
```

Pro aktuální hodinu se počítá pouze čas od začátku intervalu do `now`.

### 8.1 Planned production time

``` text
planned_time = interval_duration - excluded_planned_breaks
```

Pro první MVP může být plánovaná přestávka buď:

-   započítaná jako downtime,
-   nebo konfiguračně vyloučená.

Architektura musí umožnit obě varianty.

### 8.2 Ideal production time

Pokud:

``` text
ideal_cycle_time = sekundy / kus
total_count = good_count + scrap_count
```

pak:

``` text
ideal_run_time = total_count × ideal_cycle_time
```

Pokud stroj vyrábí více kusů na cyklus, výpočet musí respektovat počet
kusů na cyklus / cavities.

Preferovaný interní model je proto:

``` text
ideal_cycle_seconds
pieces_per_cycle
cycle_count
```

a nikoliv slepé předpokládání jednoho kusu na cyklus.

### 8.3 Scrap loss

Scrap není další fyzický prostoj stroje. Jde o **ekvivalent ztraceného
produktivního času**.

Například:

``` text
scrap_loss_time =
    scrap_count × ideal_time_per_piece
```

nebo ekvivalentní výpočet přes cykly podle charakteru konkrétní
technologie.

### 8.4 Good production time

``` text
good_production_time =
    good_count × ideal_time_per_piece
```

### 8.5 Runtime

``` text
runtime = planned_time - downtime
```

### 8.6 Speed loss

``` text
speed_loss =
    runtime - ideal_run_time
```

kde:

``` text
ideal_run_time =
    good_production_time + scrap_loss_time
```

Tedy:

``` text
runtime =
    good_production_time
    + scrap_loss_time
    + speed_loss
```

a:

``` text
planned_time =
    good_production_time
    + scrap_loss_time
    + speed_loss
    + downtime
```

Použij tolerance proti drobným rozdílům způsobeným timestampy a
zaokrouhlením.

Nikdy nezobrazuj zápornou ztrátu. Pokud vznikne nekonzistence dat, označ
ji jako data-quality problém.

------------------------------------------------------------------------

## 9. OEE

Aplikace musí umět vypočítat standardní OEE komponenty:

``` text
Availability
Performance
Quality
OEE
```

### Availability

``` text
Availability = Runtime / Planned Production Time
```

### Performance

``` text
Performance = Ideal Run Time / Runtime
```

### Quality

``` text
Quality = Good Count / Total Count
```

### OEE

``` text
OEE = Availability × Performance × Quality
```

Interně počítej s desetinnými čísly.

Na UI zobraz procenta.

Pokud vstupní data neumožňují korektní OEE, nevymýšlej hodnotu. API musí
vrátit stav `insufficient_data`.

------------------------------------------------------------------------

## 10. Hlavní dashboard

Dashboard musí být navržen primárně pro Full HD obrazovku:

``` text
1920 × 1080
```

Musí ale být responzivní.

### Header

Nahoře zobraz:

``` text
LINE / MACHINE NAME

Current product / reference
Current order

SHIFT
06:00–14:00

Current time

TARGET
ACTUAL
DIFFERENCE
```

Pokud některé údaje nejsou dostupné, komponenta se musí umět skrýt.

### Hlavní hodinový graf

Dominantní část obrazovky.

Každá hodina = jeden horizontální **agregovaný stacked bar ve stylu výrobního loss baru**.

**DŮLEŽITÉ: bar není chronologická timeline událostí.** Stejné typy ztrát za daný hodinový interval se nejprve sečtou a teprve potom se vykreslí jako jeden souvislý blok.

Nezobrazuj tedy:

``` text
GOOD → STOP → GOOD → SLOW → GOOD → STOP → GOOD
```

Místo toho zobraz agregované kategorie seskupené zleva:

``` text
GOOD PRODUCTION | SPEED LOSS | MICRO STOPS / OTHER LOSS | DOWNTIME | SCRAP LOSS
```

Například:

``` text
06–07 |██████████████████████████████████|██████|██|████|██|
      |            GOOD 42.3 min         |SLOW 8|MS|STOP|SC|
```

Stejný princip použij pro všechny hodiny směny:

``` text
06–07 | GOOD ─────────────────────────── | SLOW | STOP | SCRAP |
07–08 | GOOD ───────────────────── | SLOW ──── | STOP | SCRAP |
08–09 | GOOD ──────────────────────────────── | STOP ─── | SCRAP |
...
```

#### Pravidla skládání baru

1. **GOOD PRODUCTION vždy začíná vlevo.**
2. Všechny události stejné kategorie se za interval agregují.
3. Jedna kategorie se v baru zobrazuje maximálně jako jeden souvislý segment.
4. Ztrátové segmenty jsou seskupené napravo od GOOD.
5. Pořadí kategorií musí být deterministické a později konfigurovatelné.
6. Výchozí pořadí pro MVP:

``` text
GOOD
SPEED LOSS
MICRO STOPS / OTHER LOSS
DOWNTIME
SCRAP LOSS
UNKNOWN
```

7. Graf **nesmí zachovávat skutečné pořadí jednotlivých událostí v čase**. Detailní chronologická timeline může být později samostatný drill-down pohled.
8. Délka segmentu odpovídá jeho časovému ekvivalentu v rámci sledovaného intervalu.
9. Součet vykreslených elapsed segmentů musí odpovídat elapsed planned time s malou tolerancí na zaokrouhlení.
10. U aktuální hodiny se budoucí čas nevykresluje jako ztráta. Může být zobrazen jako neutrální/neaktivní zbytek celkové hodinové kapacity.

Cílem tedy není ukázat, **kdy přesně** ztráta nastala, ale **kolik z dostupného výrobního potenciálu daná kategorie spotřebovala**. Toto je zásadní vizualizační princip aplikace.

Barevný význam musí být konfigurovatelný.

Výchozí význam:

``` text
GREEN   = good production
YELLOW  = speed loss
PURPLE  = micro stops / další krátké ztráty
RED     = downtime
ORANGE  = scrap loss
GREY    = elapsed time bez dostatečných dat / unknown
DARK    = budoucí část aktuální hodiny
```

Nepoužívej barvu jako jediný nositel informace. Dashboard musí mít jasnou legendu. Pokud je segment dostatečně široký, zobraz v něm i hodnotu, například `42.3m`, `8.0m` nebo `4.2m`. U velmi malých segmentů lze text skrýt.

Každý hodinový řádek může vedle baru zobrazit například:

``` text
OEE 83%
Good 102
Scrap 4
Stop 6m
```

Na velkém monitoru musí být vše čitelné ze vzdálenosti několika metrů.

### Aktuální hodina

Aktuální hodina musí být vizuálně zvýrazněna.

Budoucí část hodiny se nesmí počítat jako ztráta.

Příklad v 10:23:

``` text
10:00–11:00

elapsed = 23 min
future = 37 min
```

KPI aktuální hodiny se počítají pouze z prvních 23 minut.

------------------------------------------------------------------------

## 11. Souhrn směny

Pod hodinovými řádky zobraz velké KPI dlaždice.

Minimálně:

``` text
OEE
AVAILABILITY
PERFORMANCE
QUALITY
GOOD PCS
SCRAP PCS
SCRAP %
DOWNTIME
SPEED LOSS
TARGET
ACTUAL
DELTA
```

Není nutné zobrazit všechny současně, pokud by UI bylo přeplněné.

Priorita shop-floor obrazovky:

1.  OEE
2.  actual vs target
3.  good pieces
4.  scrap
5.  downtime
6.  speed loss

------------------------------------------------------------------------

## 12. Live aktualizace

Dashboard musí fungovat téměř real-time.

Pro MVP použij jednoduchý polling.

Například:

``` text
refresh every 10 seconds
```

Interval musí být konfigurovatelný.

Není nutné zavádět WebSocket, pokud polling poskytne dostatečnou odezvu.

API musí být navrženo tak, aby pozdější přechod na SSE/WebSocket nebyl
problém.

Frontend nesmí při každém refreshi reloadovat celou stránku.

------------------------------------------------------------------------

## 13. Backend API

Navrhni REST API minimálně:

``` text
GET /api/health

GET /api/displays/{display_id}

GET /api/displays/{display_id}/dashboard

POST /api/displays/{display_id}/heartbeat

GET /api/machines

GET /api/machines/{machine_id}

GET /api/machines/{machine_id}/current-shift

GET /api/machines/{machine_id}/shift/{shift_id}

GET /api/config/shifts
```

Hlavní endpoint:

``` text
GET /api/displays/{display_id}/dashboard
```

má vracet frontend-ready view model, aby Raspberry Pi nemuselo dělat
složité výpočty.

Příklad:

``` json
{
  "display": {
    "id": "DISPLAY-07"
  },
  "machine": {
    "id": "92",
    "name": "Machine 92"
  },
  "shift": {
    "name": "Morning",
    "start": "2026-09-23T06:00:00+02:00",
    "end": "2026-09-23T14:00:00+02:00"
  },
  "production": {
    "product": "ABC123",
    "order": "WO123456",
    "target": 850,
    "actual_good": 811,
    "scrap": 12
  },
  "hours": [
    {
      "start": "2026-09-23T06:00:00+02:00",
      "end": "2026-09-23T07:00:00+02:00",
      "elapsed_seconds": 3600,
      "good_seconds": 2860,
      "speed_loss_seconds": 310,
      "scrap_loss_seconds": 70,
      "downtime_seconds": 360,
      "good_count": 103,
      "scrap_count": 3,
      "oee": 0.794
    }
  ],
  "summary": {
    "availability": 0.91,
    "performance": 0.94,
    "quality": 0.98,
    "oee": 0.838
  }
}
```

Čísla v příkladu jsou pouze demonstrační.

------------------------------------------------------------------------

## 14. Admin konfigurace

MVP musí mít jednoduchou administrační stránku.

Není potřeba budovat složitý enterprise admin systém.

Musí umožnit:

### Displays

-   vytvořit display
-   pojmenovat display
-   přiřadit machine / line
-   zapnout / vypnout display
-   nastavit dashboard type
-   vidět online/offline

### Machines

-   interní ID
-   Ciclades ID
-   název
-   aktivní/neaktivní
-   pieces per cycle
-   fallback ideal cycle time

### Shifts

-   název
-   start
-   end
-   dny platnosti

### Dashboard settings

-   refresh interval
-   zobrazené KPI
-   thresholds
-   případně barvy

------------------------------------------------------------------------

## 15. Timezone

Veškeré timestampy ukládej a zpracovávej bezpečně s timezone.

Výchozí závod může používat:

``` text
Europe/Prague
```

nebo podle lokality závodu jinou IANA timezone.

Timezone musí být konfigurovatelná per plant/site.

Noční směna přes změnu dne musí fungovat korektně.

Architektura by měla respektovat i DST změny.

------------------------------------------------------------------------

## 16. Cache a zatížení Ciclades

Dashboardy nesmí každých 10 sekund generovat desítky identických
náročných SQL dotazů do produkční MES databáze.

Backend proto musí mít jednoduchou cache vrstvu.

Pro MVP může být in-memory cache.

Například:

``` text
machine + shift + time bucket
TTL = 5–10 seconds
```

Pokud deset monitorů sleduje stejnou linku, backend má ideálně provést
jeden MES dotaz a výsledek sdílet.

Později lze přidat Redis.

------------------------------------------------------------------------

## 17. Odolnost při výpadku MES

Pokud Ciclades není dostupný:

dashboard nesmí spadnout na prázdnou bílou stránku.

Zobraz:

``` text
DATA CONNECTION LOST

Last successful update:
10:34:21
```

Pokud máme poslední validní data v cache, ponech je zobrazená, ale jasně
označ jako stale.

Frontend musí mít retry mechanismus.

------------------------------------------------------------------------

## 18. Data quality

Backend musí detekovat alespoň:

-   chybějící ideal cycle
-   záporné hodnoty
-   překrývající se downtime intervaly
-   downtime mimo směnu
-   scrap \> total production
-   neznámý stroj
-   chybějící mapping
-   nesmyslné timestampy
-   Performance výrazně nad 100 %

Performance nad 100 % může být reálný důsledek špatně nastaveného ideal
cycle, proto hodnotu svévolně neopravuj.

Označ ji jako možný data-quality problém.

------------------------------------------------------------------------

## 19. Testovací data

Protože skutečné Ciclades SQL schéma zatím nebude k dispozici, vytvoř
**MockMesDataProvider**.

Mock musí simulovat realistickou osmihodinovou směnu.

Například:

-   normální výroba
-   několik krátkých stopů
-   jeden delší downtime
-   slow running
-   scrap
-   aktuálně běžící hodinu
-   jednu hodinu s vysokým scrapem
-   jednu hodinu s nízkým Performance

Mock data nesmí být pouze statický screenshot.

Dashboard se má v demo režimu chovat jako živý.

Použij environment variable například:

``` text
MES_PROVIDER=mock
```

a:

``` text
MES_PROVIDER=ciclades
```

------------------------------------------------------------------------

## 20. Testy

Implementuj minimálně unit testy pro KPI Engine.

Otestuj:

``` text
100% ideal production
downtime only
speed loss only
scrap only
combination of all losses
partial current hour
night shift over midnight
zero production
missing ideal cycle
multiple cavities / pieces per cycle
```

Nejdůležitější invariant:

``` text
good_time
+ speed_loss
+ scrap_loss
+ downtime
≈ elapsed_planned_time
```

------------------------------------------------------------------------

## 21. Logging

Backend musí používat strukturované logování.

Loguj:

-   startup
-   MES connection status
-   SQL query failures
-   dashboard calculation failures
-   data quality warnings
-   display heartbeat změny
-   konfigurace display mappingu

Nikdy neloguj databázová hesla.

------------------------------------------------------------------------

## 22. Security

Ciclades připojení musí být read-only.

Použij read-only SQL účet, pokud je dostupný.

Backend nesmí umožňovat zapisovat do Ciclades.

Admin část aplikace připrav tak, aby bylo možné později přidat OIDC/SSO,
například přes Authentik.

Pro první MVP může být autentizace administrace jednoduchá, ale
architektura ji nesmí mít natvrdo promíchanou s business logikou.

Samotný shop-floor `/display/{id}` pohled může být v interní LAN
read-only bez interaktivního loginu.

------------------------------------------------------------------------

## 23. UX pravidla

Toto není kancelářský BI dashboard.

Je to **Andon / shop-floor informační obrazovka**.

Proto:

-   velké písmo
-   vysoký kontrast
-   minimum textu
-   žádné malé tabulky
-   žádné dropdowny na hlavní obrazovce
-   žádné scrollování při 1920×1080
-   nejdůležitější informace musí být pochopitelná během 2--3 sekund
-   aktuální stav musí být vidět z několika metrů
-   žádné dekorativní animace
-   žádné hover-only informace nutné pro pochopení dashboardu

Dashboard musí fungovat i bez myši a klávesnice.

------------------------------------------------------------------------

## 24. Design reference

Referenční screenshot potvrzuje důležitý vizualizační princip: **loss segmenty jsou agregované podle kategorie a seskupené vedle sebe zleva doprava; nejde o chronologickou timeline událostí.**

Inspirací je princip výrobních dashboardů Shoplogix:

-   real-time shop-floor visibility
-   actual vs expected production
-   cycle / performance losses
-   downtime
-   scrap
-   hour-by-hour OEE / production performance

Nevytvářej pixelovou kopii Shoplogix.

Použij pouze výrobní informační princip a vytvoř vlastní vizuální
systém.

Klíčovým požadavkem tohoto projektu je:

> **osm (nebo dle délky směny odpovídající počet) horizontálních
> hodinových stacked barů, které na první pohled ukazují, kde se během
> směny ztratil výrobní čas.**

------------------------------------------------------------------------

## 25. MVP scope

První funkční verze musí obsahovat:

-   Docker Compose
-   FastAPI backend
-   PostgreSQL
-   React + TypeScript frontend
-   mock MES provider
-   připravený Ciclades SQL provider
-   konfiguraci strojů
-   konfiguraci směn
-   Display ID mapping
-   hodinový stacked dashboard
-   shift summary
-   OEE
-   Availability
-   Performance
-   Quality
-   good count
-   scrap
-   downtime
-   speed loss
-   polling
-   heartbeat
-   error / offline state
-   základní admin konfiguraci
-   unit testy KPI engine
-   README s instalací
-   `.env.example`

------------------------------------------------------------------------

## 26. Co zatím NEIMPLEMENTOVAT

V první iteraci nepřidávej bez požadavku:

-   Kubernetes
-   Kafka
-   TimescaleDB
-   Elasticsearch
-   Grafana
-   komplexní event streaming
-   machine learning
-   AI predikce
-   cloud služby
-   mobilní aplikaci
-   vlastní IoT sběr dat ze strojů
-   OPC UA
-   MQTT

Ciclades je pro tento projekt zdrojem výrobních dat.

Cílem MVP je **rychlá, robustní vizualizace a správné výpočty**, ne
budování dalšího MES.

------------------------------------------------------------------------

## 27. Budoucí rozšíření

Architektura má umožnit později přidat:

-   více závodů
-   více výrobních hal
-   centrální dashboard
-   dlouhodobé trendy
-   Pareto downtime reasons
-   Pareto scrap reasons
-   drill-down na jednotlivé stop events
-   production order history
-   denní / týdenní / měsíční report
-   takt vs actual
-   operator input
-   ruční klasifikaci neznámého prostojového důvodu
-   Authentik SSO
-   alerting
-   CMMS integraci
-   API pro další interní systémy
-   SSE / WebSocket live updates
-   Redis cache
-   historický analytický datastore, pokud bude později potřeba

------------------------------------------------------------------------

## 28. Postup implementace pro Codex

Pracuj iterativně, ale pokračuj až k funkčnímu MVP.

### Fáze 1 -- repository

Vytvoř:

-   strukturu projektu
-   Dockerfiles
-   docker-compose
-   environment config
-   README

Ověř:

``` bash
docker compose up --build
```

### Fáze 2 -- backend

Implementuj:

-   FastAPI
-   PostgreSQL
-   migrations
-   models
-   shift engine
-   KPI engine
-   mock MES provider
-   API

Přidej testy.

### Fáze 3 -- frontend

Implementuj nejdříve skutečný shop-floor dashboard.

Nepoužívej placeholderovou admin šablonu jako hlavní UI.

Dashboard musí být vizuálně použitelný už v této fázi.

### Fáze 4 -- display management

Implementuj:

-   Display ID
-   mapping
-   heartbeat
-   online/offline

### Fáze 5 -- admin

Implementuj jednoduchou konfiguraci:

-   machines
-   displays
-   shifts

### Fáze 6 -- Ciclades adapter

Připrav skutečný SQL Server connection layer.

Pokud chybí informace o skutečném databázovém schématu:

**ZASTAV pouze tuto část.**

Nevymýšlej SQL tabulky.

Vytvoř dokument:

``` text
docs/ciclades-mapping.md
```

a přesně napiš, jaké informace je nutné dodat.

Zbytek aplikace musí fungovat přes mock provider.

------------------------------------------------------------------------

## 29. Instrukce pro Codex

Tento dokument je **implementační specifikace**, nikoliv žádost o další
návrh.

Po jeho načtení:

1.  projdi celý dokument
2.  vytvoř implementation plan
3.  následně začni projekt skutečně implementovat
4.  nevytvářej pouze pseudokód
5.  nevytvářej pouze UI mockup
6.  vytvoř spustitelný Docker projekt
7.  průběžně spouštěj testy
8.  průběžně opravuj chyby
9.  udržuj README aktuální
10. po každé významné fázi ověř, že aplikace stále běží

Pokud je některý detail nejasný, zvol rozumný technický default, pokud
tím nevznikne riziko nesprávného napojení na produkční Ciclades.

**Nevymýšlej Ciclades databázové schéma.**

Pro neznámé Ciclades údaje vytvoř interface a mock implementaci.

------------------------------------------------------------------------

## 30. Definition of Done -- MVP

MVP je hotové, pokud lze na čisté Ubuntu VM udělat:

``` bash
git clone <repo>
cd production-dashboard
cp .env.example .env
docker compose up -d --build
```

a následně otevřít například:

``` text
http://SERVER/display/demo
```

Na obrazovce se zobrazí:

-   výrobní linka
-   aktuální směna
-   aktuální výrobek
-   hodinové stacked bary
-   good production
-   speed loss
-   scrap loss
-   downtime
-   OEE
-   Availability
-   Performance
-   Quality
-   good/scrap kusy
-   actual vs target

Hodinové bary musí splnit tento vizuální invariant:

``` text
GOOD | agregovaná LOSS kategorie A | agregovaná LOSS kategorie B | ...
```

Stejná loss kategorie se v jednom hodinovém baru nesmí objevit ve více oddělených segmentech jen proto, že během hodiny nastala opakovaně. Události se nejprve agregují podle kategorie a teprve potom vykreslí.

Data v demo režimu dodává MockMesDataProvider.

Aplikace se automaticky aktualizuje.

Po několika hodinách běhu nesmí dashboard vyžadovat ruční refresh.

Po výpadku backendu nebo MES se UI korektně zotaví.

------------------------------------------------------------------------

# Poznámka k implementačnímu modelu

Pro první end-to-end vytvoření projektu použij v Codexu **GPT-5.6 Sol s
vysokým nebo maximálním reasoning effort**, případně **GPT-6 Astra**,
pokud je v daném Codex účtu dostupná.

Pro následné menší, přesně vymezené úpravy lze použít levnější/rychlejší
model.

Nejdůležitější je nejprve vytvořit kvalitní architekturu, KPI engine a
funkční vertikální řez:

``` text
Mock MES
→ Backend
→ KPI calculation
→ REST API
→ React dashboard
→ Docker
→ Browser kiosk
```

Teprve potom napojovat skutečné Ciclades SQL.
