# Channel and campaign normalisation

The de-facto join key between ad spend and web behaviour is the campaign name,
and the campaign name is the least disciplined string in the stack. This file
makes it a key.

---

## 1. The campaign-key resolution order

Try in order. Record which rung produced the key, exactly as
`identity-resolution` records its rung.

| Rung | Method | Confidence | Applies to |
|---|---|---|---|
| **1** | **Platform campaign ID**, mapped to `campaign_key` in `config.campaign_map` | 1.00 | any touch carrying an ad-platform ID or a click ID resolvable to one |
| **2** | **Click ID lookup** — `gclid`, `fbclid`, `li_fat_id`, `msclkid` captured at landing, resolved to the campaign via the platform's own reporting | 0.99 | paid clicks where the parameter survived the redirect chain |
| **3** | **Structured UTM parse** against the declared convention | 0.90 | owned channels following the standard |
| **4** | **Deterministic transform** of `utm_campaign`: lowercase, trim, collapse separators, strip declared noise tokens | 0.80 | legacy and third-party traffic |
| — | fuzzy or similarity matching of campaign names | **prohibited** | — |
| — | unmapped | → **review queue**, never an "other" bucket | — |

Campaign **IDs are stable; names are not.** Wherever an ID exists, naming never
enters the resolution at all — which is why rung 1 is worth the effort of
maintaining the map.

```sql
CREATE TABLE IF NOT EXISTS config.campaign_map (
  platform        STRING NOT NULL,   -- closed enum
  platform_campaign_id STRING NOT NULL,
  campaign_key    STRING NOT NULL,   -- the conformed key
  campaign_label  STRING,            -- human-readable, changeable, never a key
  channel         STRING NOT NULL,
  effective_from  DATE   NOT NULL,
  effective_to    DATE,
  owner           STRING NOT NULL
);
```

`effective_from` / `effective_to` matter because campaigns get repurposed. The
same ID running a brand campaign in Q1 and a promotion in Q3 is two campaign
keys, and without the dating they merge.

---

## 2. The UTM standard

A convention is only useful if it is parseable. Positional, lowercase,
hyphen-separated, closed vocabularies per position:

```
utm_campaign = <channel>-<region>-<period>-<audience>-<asset>
               paid-social-emea-2026q3-lookalike-carousel

utm_source   = the platform, from a closed enum: google | meta | linkedin | bing | klaviyo | partner-<name>
utm_medium   = the type,     from a closed enum: cpc | paid-social | email | organic-social | display | affiliate | referral
utm_content  = the creative or variant identifier
utm_term     = keyword, paid search only
```

```python
UTM_POSITIONS = ["channel", "region", "period", "audience", "asset"]
SOURCES  = {"google", "meta", "linkedin", "bing", "klaviyo", "partner"}
MEDIUMS  = {"cpc", "paid-social", "email", "organic-social", "display",
            "affiliate", "referral"}

def parse_utm_campaign(raw: str) -> dict | None:
    parts = raw.strip().lower().split("-")
    if len(parts) != len(UTM_POSITIONS):
        return None                     # → review queue, not a guess
    return dict(zip(UTM_POSITIONS, parts))
```

**Returning `None` and queueing is the whole point.** A parser that pads
missing positions or tolerates extra ones produces keys that look right and
group the wrong things.

### Enforcing it

- A link builder (a small internal tool or a spreadsheet with validation) beats
  documentation. Conventions that require humans to remember five positions
  decay within a quarter.
- **Audit inbound UTMs weekly** against the vocabularies and report violations
  by owner. Violations found in week one are fixable; violations found in month
  six are history.
- Email platforms often append their own tracking parameters. Declare which
  parameters are yours and strip the rest before parsing.

---

## 3. Channel rules

`config.dim_channel` holds ordered rules with an explicit fallthrough.
Evaluation order **is** the definition — the first match wins, so a rule set is
not a set, it is a sequence.

| # | Condition | Channel |
|---|---|---|
| 1 | `medium = 'cpc'` and `source = 'google'` | Paid Search — Google |
| 2 | `medium = 'cpc'` and `source = 'bing'` | Paid Search — Bing |
| 3 | `medium IN ('paid-social','paid_social')` | Paid Social |
| 4 | `medium = 'email'` | Email |
| 5 | `medium = 'display'` | Display |
| 6 | `medium = 'affiliate'` | Affiliate |
| 7 | `source` matches the organic-search engine list and `medium = 'organic'` | Organic Search |
| 8 | `source` matches the social-network list and `medium = 'referral'` | Organic Social |
| 9 | referrer host = own domain | **Self-referral** (a defect, not a channel) |
| 10 | referrer present, no rule matched | Referral |
| 11 | no referrer, no UTM | **Direct** |
| 12 | anything else | **Unclassified** |

Two naming choices that are doing work:

- **Row 9 is `Self-referral`, not `Referral`.** Your own domain in the referrer
  means a session broke mid-journey — usually a payment gateway, an auth hop or
  a subdomain without shared cookies. It is a tracking defect with a fix, and
  bucketing it as Referral hides it forever.
- **Row 12 is `Unclassified`, not `Other`.** "Other" reads as a residual people
  accept; "Unclassified" reads as work outstanding, which it is. Report its
  volume in every channel breakdown.

Every rule set is versioned (`channel_rule_version`), and a change is a marked
event on the timeline, because it restates every historical channel number.

---

## 4. The Direct problem, worked

Direct is not a channel. It is what is left when the browser sent no referrer
and nobody tagged the link. It contains:

| Actually | Why it lands in Direct |
|---|---|
| Untagged email | a template shipped without UTMs, or a client that strips them |
| Dark social | messaging apps and private shares send no referrer |
| App-to-web | in-app browsers frequently drop the referrer |
| Stripped referrer | HTTPS→HTTP hops, some privacy settings, `rel="noreferrer"` links |
| QR codes and offline | no referrer by construction unless the URL carries UTMs |
| Type-in and bookmarks | the only traffic that is genuinely direct |

Three obligations:

1. **Record the reason** on every Direct touch: `no_referrer`,
   `referrer_unmapped`, `self_referral_stripped`. The mix tells you which fix
   pays.
2. **Monitor the Direct share daily.** A step change is a tagging regression
   and is fixable the same week; a slow rise is decay in link discipline.
3. **If last-non-direct is used, say so in the output.** It is a defensible
   rule that silently reassigns credit, and an unstated default is how a
   channel gets credited for touches it did not have.

```sql
-- the daily Direct-share monitor
SELECT event_date,
       SAFE_DIVIDE(COUNTIF(channel = 'Direct'), COUNT(*))        AS direct_share,
       SAFE_DIVIDE(COUNTIF(channel = 'Unclassified'), COUNT(*))  AS unclassified_share,
       SAFE_DIVIDE(COUNTIF(channel = 'Self-referral'), COUNT(*)) AS self_referral_share
FROM marts.fact_touchpoint
WHERE event_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
GROUP BY 1 ORDER BY 1;
```

---

## 5. Drift detection

Naming conventions decay, and the decay looks like performance change.

```sql
-- campaigns that appeared or disappeared in the last 30 days
WITH life AS (
  SELECT campaign_key, MIN(event_date) AS first_seen, MAX(event_date) AS last_seen,
         COUNT(*) AS touches
  FROM marts.fact_touchpoint
  GROUP BY 1
)
SELECT *,
  CASE WHEN first_seen >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) THEN 'new'
       WHEN last_seen  <  DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) THEN 'stopped'
  END AS status
FROM life
WHERE first_seen >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
   OR last_seen  <  DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY);
```

Read it as pairs. **A campaign that stopped and a near-identical one that
started on the same day is one campaign that was renamed**, and treating them
as two halves its measured performance and breaks its trend.

Also monitor:

- **UTM violation rate** — inbound `utm_campaign` values that fail the parse.
- **Spend without touches** — a campaign with ad spend and zero attributable
  touches is a tracking break, not a campaign that failed.
- **Touches without spend** — organic traffic mis-tagged as paid, which
  silently inflates paid efficiency.

The last two are the pair that most often explains an implausible CPA.
