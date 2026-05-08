# Per-item mastery scoring

Implementation: [`./itemMastery.ts`](./itemMastery.ts)
Storage and fan-out: [`./incorrectPhraseTracker.ts`](./incorrectPhraseTracker.ts)
Phrase-level companion: [`./mastery.ts`](./mastery.ts)

## 1. Purpose

This module computes a 0–1 mastery score for each *grammar item* (one
comma-split token from `Spanish.grammar`) and each *Spanish target word* the
user has been tested on. It complements the per-phrase mastery in
[`./mastery.ts`](./mastery.ts) with a fine-grained "what does the user know?"
signal:

- per-grammar-item: how well the user has internalized e.g. "polite address"
  across every phrase that tests it;
- per-word: how reliably the user produces e.g. "hola" across every phrase
  that uses it.

The score is **cross-phrase** by design: a successful demonstration of an
item in phrase B counts as a positive trial for that same item appearing on
phrase A. The tracker fans the resulting score out onto every record entry
that names the same item / word string so the UI can render a consistent
number wherever that item appears.

## 2. Inputs and event-to-x derivation

For each event the tracker derives an outcome `x ∈ [0, 1]` per item /
per word and feeds it to `updateItemScore`.

| Event source                           | Grammar item `g`                                                    | Word `w`                                          |
| -------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------- |
| Attempt + AI grading (success path)    | `g ∈ failedGrammarItems → x=0`; else `isAccuracySuccess → x=1`; else **skip** | `w ∈ missingWords → x=0`; else `x=1`              |
| Attempt + fallback classification (`'failed'` status) | **skip** (no item-level info from the fallback)            | `w ∈ missingWords → x=0`; else `x=1`              |
| Reveal (fallback `'n/a'` status)       | `decayItemOnReveal` for every item in `Spanish.grammar`              | `decayItemOnReveal` for every target word          |
| Practice (Try Again)                   | no-op                                                                | no-op                                              |

The "skip" rule for the ambiguous AI case (item not flagged AND attempt was
not an accuracy success) is intentional: there is no clean signal that
either favors or punishes the item. Polluting the EMA with a synthetic
0.5-credit trial would smear scores across unrelated rules.

Practice events never reach the tracker — they're filtered out at the
[`./useLessonSession.ts`](./useLessonSession.ts) level.

## 3. State

```ts
interface ItemScore {
  trialsEff: number;             // decayed effective trial count, [0, ~20]
  successSumEff: number;         // decayed sum of x outcomes
  stability: number;             // EMA of x in [0, 1]
  mastery: number;               // computed blend in [0, 1] (cached)
  lastUpdatedAtEventSeq: number; // per-session event seq of last update
}
```

All fields are plain numbers. The struct is JSON-serializable as-is and
lives on every `IncorrectGrammarItemEntry` and `WordMistakeEntry` (see
storage section below). `mastery` is cached so callers don't recompute the
formula every render; the tracker is the only mutator.

## 4. Formulas

For each new trial with outcome `x`:

```
trialsEff'      = ITEM_DECAY_GAMMA * trialsEff      + 1
successSumEff'  = ITEM_DECAY_GAMMA * successSumEff  + x
stability'      = clamp01((1 - STABILITY_EMA_ALPHA) * stability + STABILITY_EMA_ALPHA * x)

pHat        = (successSumEff' + ITEM_LAPLACE_ALPHA * 0.5) / (trialsEff' + ITEM_LAPLACE_ALPHA)
confidence  = trialsEff' / (trialsEff' + ITEM_CONFIDENCE_K)

mastery     = clamp01(ITEM_W_P_HAT * pHat + ITEM_W_STABILITY * stability' + ITEM_W_CONFIDENCE * confidence)
```

For reveal events:

```
stability'  = clamp01(stability * ITEM_REVEAL_STABILITY_DECAY)
mastery'    = recomputed from (trialsEff, successSumEff, stability')   // trialsEff unchanged
```

`STABILITY_EMA_ALPHA = 0.3` is reused from [`./mastery.ts`](./mastery.ts) so
per-item stability uses the same blend rate as per-phrase stability. All
other constants are defined in [`./itemMastery.ts`](./itemMastery.ts).

Defaults:

| Constant                      | Default | Purpose                                |
| ----------------------------- | ------- | -------------------------------------- |
| `ITEM_DECAY_GAMMA`            | 0.95    | Recency decay per trial                |
| `ITEM_LAPLACE_ALPHA`          | 2       | Smoothing prior on `pHat`              |
| `ITEM_CONFIDENCE_K`           | 5       | Saturating denominator on `confidence` |
| `ITEM_W_P_HAT`                | 0.5     | Weight on smoothed success rate        |
| `ITEM_W_STABILITY`            | 0.3     | Weight on stability EMA                |
| `ITEM_W_CONFIDENCE`           | 0.2     | Weight on coverage                     |
| `ITEM_REVEAL_STABILITY_DECAY` | 0.7     | Reveal multiplier (mirrors `mastery.ts`) |
| `STABILITY_EMA_ALPHA`         | 0.3     | Reused from `./mastery.ts`             |

## 5. Why each term

### `pHat` (smoothed success rate, weight 0.5)

The headline signal: out of all trials, how often did the user get it
right? Smoothing with a Laplace-style prior (`ITEM_LAPLACE_ALPHA * 0.5` in
the numerator, `ITEM_LAPLACE_ALPHA` in the denominator) pulls 0-trial
states toward 0.5 instead of an arbitrary value, and prevents 1/1 from
snapping to 100% or 1/1 fail snapping to 0%. Highest weight because
"does it actually come out right?" is the most important question.

### `stability` (EMA, weight 0.3)

Captures *consistency*. A user with `pHat = 0.7` could be steadily 7/10 or
streaky 5 wrong then 5 right in a row — those should not feel equal. The
stability EMA punishes the streaky case because the latest trial dominates.
Same `α = 0.3` as phrase-level stability so the two scales match.

### `confidence` (saturating coverage, weight 0.2)

Prevents over-trusting a tiny sample. `n/(n+k)` with `k = 5` means at
`n = 5` the user has earned half of the confidence credit, at `n = 20` they
have ~80%. Until the user has been tested several times, the confidence
term keeps mastery cosmetically lower so the UI doesn't flash a "mastered"
band on the strength of one lucky win.

The three weights sum to 1.0, mirroring the
`accuracy / fluency / stability = 0.5 / 0.3 / 0.2` shape used in
[`./mastery.ts`](./mastery.ts).

## 6. Recency decay

`ITEM_DECAY_GAMMA = 0.95` shrinks both `trialsEff` and `successSumEff` by
5% on every new trial. Concretely:

| γ    | half-life (trials) | effective window (~3 half-lives) |
| ---- | ------------------ | -------------------------------- |
| 0.99 | ~69                | ~200                             |
| 0.95 | ~13.5              | ~40                              |
| 0.90 | ~6.6               | ~20                              |
| 0.80 | ~3.1               | ~9                               |

`trialsEff` saturates near `1 / (1 - γ) = 20` for an infinite stream of
trials, which means the `confidence` term naturally caps at
`20 / (20 + 5) = 0.8`. That cap is intentional — it keeps mastery
slightly plastic even after long streaks, so a regression after a hundred
wins still moves the score noticeably.

## 7. Reveal handling

Reveal events arrive as `gradingStatus === 'n/a'` through the fallback
classification call. The tracker calls `decayItemOnReveal` for every
grammar item in the phrase and every target word, mirroring the multiplicative
reveal decay used in [`./mastery.ts`](./mastery.ts) (`REVEAL_STABILITY_DECAY = 0.7`).

We *don't* push a synthetic `x = 0` trial because that would inflate
`trialsEff` for a non-trial event and could push the user past
`MASTERY_LEARNING_CEIL` purely from reveals.

## 8. Cross-phrase fan-out

The tracker holds two source-of-truth maps during a live session:

```
grammarItemScores : Map<itemString, ItemScore>
wordScores        : Map<wordString, ItemScore>
```

Every successful update writes the new `ItemScore` reference to both the
map AND every existing entry across every record that has a matching
`item` / `word` string:

```
Event ─▶ applyAiGrading / applyFallbackClassification
        ─▶ bumpGrammarItem(item, x, eventSeq)
              ─▶ grammarItemScores.set(item, next)
              ─▶ for record in records:
                   for entry in record.incorrectGrammarItems:
                     if entry.item === item: entry.score = next
        ─▶ bumpWord(word, x, eventSeq, originRecord)
              ─▶ wordScores.set(word, next)
              ─▶ same fan-out, plus lazily creates a WordMistakeEntry
                 on the originRecord if x < 1 and none exists yet
```

The UI never reads from the live tracker. Records flow through
`useLessonSession`'s `incorrectPhraseRecords` snapshot, and the entry-level
`score` field is the only thing the sidebar consumes. A second lookup map
is built client-side by walking entries — see
[`apps/web/src/app/components/SessionHistoryLogView/index.tsx`](../../../apps/web/src/app/components/SessionHistoryLogView/index.tsx) — so a phrase's
grammar-item or word can show its cross-phrase mastery even if no entry
exists for that phrase yet.

On checkpoint resume the tracker is constructed with `seedRecords`; it
walks every entry and seeds both maps with the latest score per key
(`lastUpdatedAtEventSeq` wins).

## 9. Display rules

- `isUntrained(score)` (`trialsEff < 1`) → render `—` (no number, no band color).
- `gradingStatus === 'pending'` → render `—` (the per-item classification has
  not arrived yet; we don't want to imply a bad mastery score).
- Otherwise render `Math.round(mastery * 100)%` colored by band:
  - `mastery < 0.6` → red (`weak`)
  - `0.6 ≤ mastery < 0.8` → amber (`stabilizing`)
  - `mastery ≥ 0.8` → emerald (`mastered`)

Cutoffs match `MASTERY_LEARNING_CEIL` and `MASTERY_STABILIZING_CEIL` from
[`./mastery.ts`](./mastery.ts).

Tooltip exposes the underlying numbers:
`n=trialsEff.toFixed(1) S=stability.toFixed(2) MI=mastery.toFixed(2) (band)`.

## 10. Worked example

Item: `polite address`. Sequence: **fail, fail, pass × 6**.

| Event | x | trialsEff | successSumEff | stability | pHat   | confidence | mastery |
| ----: | -: | --------: | ------------: | --------: | -----: | ---------: | ------: |
| start |  — |    0.000  |        0.000  |    0.000  | 0.500  |    0.000   |  0.250  |
| fail  | 0  |    1.000  |        0.000  |    0.000  | 0.333  |    0.167   |  0.200  |
| fail  | 0  |    1.950  |        0.000  |    0.000  | 0.253  |    0.281   |  0.183  |
| pass  | 1  |    2.853  |        1.000  |    0.300  | 0.412  |    0.363   |  0.369  |
| pass  | 1  |    3.710  |        1.950  |    0.510  | 0.516  |    0.426   |  0.497  |
| pass  | 1  |    4.524  |        2.853  |    0.657  | 0.591  |    0.475   |  0.588  |
| pass  | 1  |    5.298  |        3.710  |    0.760  | 0.645  |    0.514   |  0.654  |
| pass  | 1  |    6.033  |        4.524  |    0.832  | 0.687  |    0.547   |  0.703  |
| pass  | 1  |    6.731  |        5.298  |    0.882  | 0.718  |    0.574   |  0.738  |

The two early failures dip mastery below 0.20; the climb is gradual but
monotonic. Without recency decay (γ = 1) the climb would be slower because
ancient failures keep weighing the same forever.

Comparison of the two ancient failures' contribution after 13 subsequent
trials:

| γ    | weight of trial 13 events ago |
| ---- | ----------------------------- |
| 1.00 | 1.000                         |
| 0.95 | 0.513                         |
| 0.90 | 0.254                         |

The 0.95 default keeps recent context dominant while letting old mistakes
fade.

## 11. Tunable knobs

| Constant                      | Default | Try lower means                              | Try higher means                                    |
| ----------------------------- | ------- | -------------------------------------------- | --------------------------------------------------- |
| `ITEM_DECAY_GAMMA`            | 0.95    | Faster forgetting; mastery reacts more       | Slower forgetting; old failures linger              |
| `ITEM_LAPLACE_ALPHA`          | 2       | Less smoothing; first trial swings more      | More smoothing; warm-start anchored harder to 0.5   |
| `ITEM_CONFIDENCE_K`           | 5       | Confidence saturates faster                  | Need more trials before mastery climbs              |
| `ITEM_W_P_HAT`                | 0.5     | Less weight on raw success rate              | More weight on raw success rate                     |
| `ITEM_W_STABILITY`            | 0.3     | Less penalty for streaky performance         | Streaky users score lower than steady ones          |
| `ITEM_W_CONFIDENCE`           | 0.2     | Single-trial mastery is less suppressed      | Sample-size discount is heavier                     |
| `ITEM_REVEAL_STABILITY_DECAY` | 0.7     | Reveals hurt less                            | Reveals hurt more                                   |

The three `ITEM_W_*` constants must sum to 1.0 if you tune them; the
`clamp01` at the end will paper over modest deviations but they break the
`mastery ∈ [0, 1]` invariant in the worst case.

## 12. Comparison with per-phrase mastery

| Aspect              | Per-phrase ([`./mastery.ts`](./mastery.ts))   | Per-item (this module)                       |
| ------------------- | --------------------------------------------- | -------------------------------------------- |
| Per-event input     | `accuracy ∈ [0, 1]` (continuous)              | `x ∈ {0, 1}` (binary, occasionally 0.5)      |
| Sample size         | Often 20+ events per phrase                   | Often 1–5 events per item                    |
| Stability EMA α     | 0.3                                           | 0.3 (reused)                                 |
| Recency decay       | None — every event weighed equally            | γ = 0.95 per trial                           |
| Cold-start handling | Initial accuracy = 0, mastery rises naturally | Laplace prior pulls toward 0.5; confidence damps low-`n` mastery |
| Cross-phrase signal | n/a                                           | Single shared score per item / per word      |

The per-phrase mastery answers "how well does the user say *this exact
phrase*?" The per-item mastery answers "how well does the user know *this
specific rule / word*, regardless of phrase?"

## 13. Limits / out of scope

- Items and words that have *never* been failed in any phrase are not
  tracked. The tracker only stores entries for grammar items the AI flagged
  and for words that have failed at least once in some phrase. This matches
  the existing "incorrect-phrase records" model — we only spend storage on
  things the user has actually struggled with. Once an item exists in the
  global score map, every subsequent appearance contributes to its score.
- Mobile UI is not yet wired; the columns currently exist only in the web
  sidebar.
- Per-item mastery is not yet surfaced on the post-lesson report page or
  used to drive cross-session SRS.
- Persistence schema migration is out of scope: every new field is
  optional with sensible defaults so old checkpoints parse cleanly, but
  there is no backfill of mastery scores on records written before the
  feature shipped.
