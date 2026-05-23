---
tags: [tournament, espn, dates, reference]
updated: 2026-04-12
---

# ESPN Tournament Date Reference

Exact dates to query the ESPN scoreboard API for every round of every NCAA tournament from 2009 to present. All dates are in `YYYYMMDD` format as required by the API endpoint.

Use this file when running a historical import — feed these dates to the API in order to retrieve game results for each round. Round assignment is determined entirely by which date you query; there is no round field in the ESPN response.

For API documentation, response structure, and full import strategy, see `espn-api-notes.md`.

## Round Timing Pattern

The tournament always follows the same weekly structure:

- **First Four / Play-in**: Tuesday–Wednesday of week 1
- **First Round (Round of 64)**: Thursday–Friday of week 1 — 16 games per day, 32 total
- **Second Round (Round of 32)**: Saturday–Sunday of week 1
- **Sweet 16**: Thursday–Friday of week 2
- **Elite Eight**: Saturday–Sunday of week 2
- **Final Four**: Saturday of week 3
- **Championship**: Monday of week 3

## Date Schedules by Year

### 2009
- Play-in (1 game): Mar 17 (`20090317`)
- First Round:  Mar 19–Mar 20 (`20090319`, `20090320`)
- Second Round: Mar 21–Mar 22 (`20090321`, `20090322`)
- Sweet 16:     Mar 26–Mar 27 (`20090326`, `20090327`)
- Elite Eight:  Mar 28–Mar 29 (`20090328`, `20090329`)
- Final Four:   Apr 4 (`20090404`)
- Championship: Apr 6 (`20090406`)

### 2010
- Play-in (1 game): Mar 16 (`20100316`)
- First Round:  Mar 18–Mar 19 (`20100318`, `20100319`)
- Second Round: Mar 20–Mar 21 (`20100320`, `20100321`)
- Sweet 16:     Mar 25–Mar 26 (`20100325`, `20100326`)
- Elite Eight:  Mar 27–Mar 28 (`20100327`, `20100328`)
- Final Four:   Apr 3 (`20100403`)
- Championship: Apr 5 (`20100405`)

### 2011
- First Four:   Mar 15–Mar 16 (`20110315`, `20110316`)
- First Round:  Mar 17–Mar 18 (`20110317`, `20110318`)
- Second Round: Mar 19–Mar 20 (`20110319`, `20110320`)
- Sweet 16:     Mar 24–Mar 25 (`20110324`, `20110325`)
- Elite Eight:  Mar 26–Mar 27 (`20110326`, `20110327`)
- Final Four:   Apr 2 (`20110402`)
- Championship: Apr 4 (`20110404`)

### 2012
- First Four:   Mar 13–Mar 14 (`20120313`, `20120314`)
- First Round:  Mar 15–Mar 16 (`20120315`, `20120316`)
- Second Round: Mar 17–Mar 18 (`20120317`, `20120318`)
- Sweet 16:     Mar 22–Mar 23 (`20120322`, `20120323`)
- Elite Eight:  Mar 24–Mar 25 (`20120324`, `20120325`)
- Final Four:   Mar 31 (`20120331`)
- Championship: Apr 2 (`20120402`)

### 2013
- First Four:   Mar 19–Mar 20 (`20130319`, `20130320`)
- First Round:  Mar 21–Mar 22 (`20130321`, `20130322`)
- Second Round: Mar 23–Mar 24 (`20130323`, `20130324`)
- Sweet 16:     Mar 28–Mar 29 (`20130328`, `20130329`)
- Elite Eight:  Mar 30–Mar 31 (`20130330`, `20130331`)
- Final Four:   Apr 6 (`20130406`)
- Championship: Apr 8 (`20130408`)

### 2014
- First Four:   Mar 18–Mar 19 (`20140318`, `20140319`)
- First Round:  Mar 20–Mar 21 (`20140320`, `20140321`)
- Second Round: Mar 22–Mar 23 (`20140322`, `20140323`)
- Sweet 16:     Mar 27–Mar 28 (`20140327`, `20140328`)
- Elite Eight:  Mar 29–Mar 30 (`20140329`, `20140330`)
- Final Four:   Apr 5 (`20140405`)
- Championship: Apr 7 (`20140407`)

### 2015
- First Four:   Mar 17–Mar 18 (`20150317`, `20150318`)
- First Round:  Mar 19–Mar 20 (`20150319`, `20150320`)
- Second Round: Mar 21–Mar 22 (`20150321`, `20150322`)
- Sweet 16:     Mar 26–Mar 27 (`20150326`, `20150327`)
- Elite Eight:  Mar 28–Mar 29 (`20150328`, `20150329`)
- Final Four:   Apr 4 (`20150404`)
- Championship: Apr 6 (`20150406`)

### 2016
- First Four:   Mar 15–Mar 16 (`20160315`, `20160316`)
- First Round:  Mar 17–Mar 18 (`20160317`, `20160318`)
- Second Round: Mar 19–Mar 20 (`20160319`, `20160320`)
- Sweet 16:     Mar 24–Mar 25 (`20160324`, `20160325`)
- Elite Eight:  Mar 26–Mar 27 (`20160326`, `20160327`)
- Final Four:   Apr 2 (`20160402`)
- Championship: Apr 4 (`20160404`)

### 2017
- First Four:   Mar 14–Mar 15 (`20170314`, `20170315`)
- First Round:  Mar 16–Mar 17 (`20170316`, `20170317`)
- Second Round: Mar 18–Mar 19 (`20170318`, `20170319`)
- Sweet 16:     Mar 23–Mar 24 (`20170323`, `20170324`)
- Elite Eight:  Mar 25–Mar 26 (`20170325`, `20170326`)
- Final Four:   Apr 1 (`20170401`)
- Championship: Apr 3 (`20170403`)

### 2018
- First Four:   Mar 13–Mar 14 (`20180313`, `20180314`)
- First Round:  Mar 15–Mar 16 (`20180315`, `20180316`)
- Second Round: Mar 17–Mar 18 (`20180317`, `20180318`)
- Sweet 16:     Mar 22–Mar 23 (`20180322`, `20180323`)
- Elite Eight:  Mar 24–Mar 25 (`20180324`, `20180325`)
- Final Four:   Mar 31 (`20180331`)
- Championship: Apr 2 (`20180402`)

### 2019
- First Four:   Mar 19–Mar 20 (`20190319`, `20190320`)
- First Round:  Mar 21–Mar 22 (`20190321`, `20190322`)
- Second Round: Mar 23–Mar 24 (`20190323`, `20190324`)
- Sweet 16:     Mar 28–Mar 29 (`20190328`, `20190329`)
- Elite Eight:  Mar 30–Mar 31 (`20190330`, `20190331`)
- Final Four:   Apr 6 (`20190406`)
- Championship: Apr 8 (`20190408`)

### 2020 — CANCELLED (COVID-19)
No games were played. Skip this year entirely.

### 2021 ⚠️ COVID Bubble (Indianapolis) — verify game counts per date
- First Four:   Mar 16–Mar 17 (`20210316`, `20210317`)
- First Round:  Mar 18–Mar 19 (`20210318`, `20210319`)
- Second Round: Mar 20–Mar 21 (`20210320`, `20210321`)
- Sweet 16:     Mar 25–Mar 26 (`20210325`, `20210326`)
- Elite Eight:  Mar 27–Mar 28 (`20210327`, `20210328`)
- Final Four:   Apr 3 (`20210403`)
- Championship: Apr 5 (`20210405`)

### 2022
- First Four:   Mar 15–Mar 16 (`20220315`, `20220316`)
- First Round:  Mar 17–Mar 18 (`20220317`, `20220318`)
- Second Round: Mar 19–Mar 20 (`20220319`, `20220320`)
- Sweet 16:     Mar 24–Mar 25 (`20220324`, `20220325`)
- Elite Eight:  Mar 26–Mar 27 (`20220326`, `20220327`)
- Final Four:   Apr 2 (`20220402`)
- Championship: Apr 4 (`20220404`)

### 2023
- First Four:   Mar 14–Mar 15 (`20230314`, `20230315`)
- First Round:  Mar 16–Mar 17 (`20230316`, `20230317`)
- Second Round: Mar 18–Mar 19 (`20230318`, `20230319`)
- Sweet 16:     Mar 23–Mar 24 (`20230323`, `20230324`)
- Elite Eight:  Mar 25–Mar 26 (`20230325`, `20230326`)
- Final Four:   Apr 1 (`20230401`)
- Championship: Apr 3 (`20230403`)

### 2024
- First Four:   Mar 19–Mar 20 (`20240319`, `20240320`)
- First Round:  Mar 21–Mar 22 (`20240321`, `20240322`)
- Second Round: Mar 23–Mar 24 (`20240323`, `20240324`)
- Sweet 16:     Mar 28–Mar 29 (`20240328`, `20240329`)
- Elite Eight:  Mar 30–Mar 31 (`20240330`, `20240331`)
- Final Four:   Apr 6 (`20240406`)
- Championship: Apr 8 (`20240408`)

### 2025
- First Four:   Mar 18–Mar 19 (`20250318`, `20250319`)
- First Round:  Mar 20–Mar 21 (`20250320`, `20250321`)
- Second Round: Mar 22–Mar 23 (`20250322`, `20250323`)
- Sweet 16:     Mar 27–Mar 28 (`20250327`, `20250328`)
- Elite Eight:  Mar 29–Mar 30 (`20250329`, `20250330`)
- Final Four:   Apr 5 (`20250405`)
- Championship: Apr 7 (`20250407`)

## Related Files

- `docs/tournament/espn-api-notes.md` — API response structure and import strategy
- `docs/tournament/espn-setup.md` — Annual activation checklist and Cloud Scheduler setup
