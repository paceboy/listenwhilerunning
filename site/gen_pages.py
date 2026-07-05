# SEO 落地页生成器:python3 site/gen_pages.py
# 每个长尾关键词一页,共享模板;改 PAGES 后重跑 + wrangler 部署即可。
import html, pathlib

BASE = "https://lwr-site.pages.dev"  # 换自定义域名后改这里重新生成
GH = "https://github.com/paceboy/listenwhilerunning"
DEMO = "https://lwr-demo.pages.dev"

CSS = """
:root{--bg:#0b0f17;--card:#131a26;--card2:#1a2333;--line:#233047;--text:#e6ecf5;--dim:#8b98ac;--acc:#35d399;--acc2:#22d3ee}
@media (prefers-color-scheme:light){:root{--bg:#f7f9fc;--card:#fff;--card2:#eef2f8;--line:#dbe3ee;--text:#16202e;--dim:#5b687a}}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.8}
.wrap{max-width:760px;margin:0 auto;padding:0 20px 60px}
nav{display:flex;justify-content:space-between;padding:14px 0;font-size:.85em}
nav a{color:var(--dim);text-decoration:none;margin-left:14px}
nav .brand{color:var(--acc);font-weight:700;margin:0}
h1{font-size:1.7em;line-height:1.4;margin:28px 0 6px}
.lede{color:var(--dim);margin-bottom:26px}
h2{font-size:1.2em;margin:30px 0 10px}
p{margin-bottom:14px}
ol,ul{margin:0 0 14px 22px}
li{margin-bottom:6px}
code{background:var(--card2);border:1px solid var(--line);border-radius:6px;padding:1px 7px;font-size:.9em}
.cta{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin:26px 0}
.cta a.b{display:inline-block;padding:10px 22px;border-radius:10px;font-weight:600;text-decoration:none;background:linear-gradient(135deg,var(--acc),var(--acc2));color:#08110c;margin-right:8px}
.cta a.g{display:inline-block;padding:10px 22px;border-radius:10px;border:1px solid var(--line);color:var(--text);text-decoration:none}
details{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin-bottom:10px}
summary{cursor:pointer;font-weight:600}
details p{color:var(--dim);font-size:.93em;margin:8px 0 0}
footer{border-top:1px solid var(--line);padding-top:20px;color:var(--dim);font-size:.85em}
footer a{color:var(--acc2);margin-right:10px}
a{color:var(--acc2)}
"""

def faq_jsonld(faqs):
    items = ",".join(
        '{"@type":"Question","name":%s,"acceptedAnswer":{"@type":"Answer","text":%s}}'
        % (jstr(q), jstr(a)) for q, a in faqs)
    return '{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[%s]}' % items

def jstr(s):
    return '"' + s.replace('\\', '\\\\').replace('"', '”') + '"'

def render(p, all_pages):
    faqs_html = "\n".join(
        f"<details><summary>{html.escape(q)}</summary><p>{a}</p></details>" for q, a in p["faqs"])
    cross = " ".join(
        f'<a href="/{o["slug"]}">{html.escape(o["short"])}</a>'
        for o in all_pages if o["slug"] != p["slug"])
    cta = f'''<div class="cta"><b>listenwhilerunning</b> is open source (AGPL-3.0) and runs on your own free-tier accounts.<br><br>
<a class="b" href="{GH}">Get it on GitHub →</a> <a class="g" href="{DEMO}">Live demo</a> <a class="g" href="/#waitlist">Hosted version waitlist</a></div>'''
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(p["title"])}</title>
<meta name="description" content="{html.escape(p["desc"])}">
<link rel="canonical" href="{BASE}/{p["slug"]}">
<script type="application/ld+json">{faq_jsonld(p["faqs"])}</script>
<style>{CSS}</style>
</head>
<body><div class="wrap">
<nav><a class="brand" href="/">listenwhilerunning</a><span><a href="{DEMO}">Demo</a><a href="{GH}">GitHub</a><a href="/zh">中文</a></span></nav>
<h1>{html.escape(p["h1"])}</h1>
<p class="lede">{p["lede"]}</p>
{p["body"]}
{cta}
<h2>FAQ</h2>
{faqs_html}
<footer><p>More guides: {cross}</p>
<p><a href="/">listenwhilerunning</a> — turn your RSS feeds and ebooks into a personal podcast. Open source, ~$0/mo.</p></footer>
</div></body></html>
"""

PAGES = [
dict(slug="rss-to-podcast", short="RSS to podcast",
 title="RSS to Podcast: Listen to Your Feeds as a Daily AI Podcast",
 desc="Convert RSS feeds into a private podcast automatically. An open-source pipeline rewrites your subscriptions into a two-host AI dialogue show and delivers it to Apple Podcasts every morning, for about $0/month.",
 h1="RSS to Podcast: Turn Your Feeds into a Daily AI Show",
 lede="You already curated the perfect reading list — newsletters, subreddits, blogs. The problem is finding time to read it. Converting RSS to a podcast lets you consume your backlog on runs and commutes, hands-free.",
 body="""
<h2>Why convert RSS to a podcast at all?</h2>
<p>Text-to-speech apps can read one article at a time, but that's not how listening works. What you actually want is a <em>feed</em>: wake up, open your podcast app, and today's episodes from your own sources are just there — queued, resumable, playable on a lock screen. That requires a pipeline, not a button.</p>
<h2>How listenwhilerunning does it</h2>
<ol>
<li><b>Fetch:</b> every morning the pipeline pulls new items from your RSS feeds (any feed works: blogs, subreddits, Hacker News, newsletters via their RSS).</li>
<li><b>Rewrite:</b> an LLM turns each article into a short two-host dialogue — question, pushback, summary — instead of a monotone readout. Short summary feeds get enriched by fetching the full article page.</li>
<li><b>Synthesize & publish:</b> neural TTS renders the dialogue with two distinct voices, and everything is published to a standard, private podcast RSS feed.</li>
</ol>
<p>Any podcast app that supports "follow by URL" (Apple Podcasts, Pocket Casts, Overcast) subscribes to your feed once and receives new episodes forever. There's no app to install and no platform in the middle.</p>
<h2>What it costs</h2>
<p>The pipeline is open source and runs on Cloudflare's free tier (R2 storage with free egress). The only variable cost is LLM rewriting — typically a few cents per day for 8 episodes — and even that is optional: without an LLM key, episodes fall back to plain readout.</p>
""",
 faqs=[
 ("Can I convert a single article instead of a whole feed?",
  "Yes. Paste any article URL into the player's settings page (or run one command) and it becomes an episode within minutes, without counting against the daily quota."),
 ("Does it work with newsletters?",
  "If your newsletter has an RSS feed (most Substack and Ghost publications do), yes — add the feed URL and issues arrive as episodes."),
 ("Will the AI hosts make things up?",
  "Dialogue scripts are limited to the fetched article text and each episode cites its source. For factual precision you can always tap through to the original link kept in the episode notes."),
 ]),

dict(slug="epub-to-audiobook", short="Epub to audiobook",
 title="Convert Epub to Audiobook Free with AI (Open Source)",
 desc="Turn any epub into a serialized audiobook with neural AI voices, free and open source. Upload from your phone, start listening in minutes, get an AI-generated intro episode discussing the book.",
 h1="Convert Epub to Audiobook — Free, AI Voices, Open Source",
 lede="Most books never get an audiobook edition, and commercial conversions charge per book. With a modern neural TTS pipeline you can convert your own epubs into serialized audiobooks for free — and start listening minutes after upload.",
 body="""
<h2>From epub to a listenable series, not one giant file</h2>
<p>A raw 10-hour MP3 is unusable on a run. listenwhilerunning splits each book into chapter-sized episodes (~10 minutes each) with per-episode AI summaries, so your player shows a proper series: resume where you left off, skim what each part covers, jump around freely.</p>
<h2>Start listening in minutes, not hours</h2>
<p>Audio generation runs roughly 10x faster than playback. Upload an epub from your phone; the first episode is ready in a few minutes, and you can listen while the rest of the book generates — you'll never catch up to it. A 200-page book completes in about 2–3 hours in the background.</p>
<h2>The intro episode</h2>
<p>Before episode one, the pipeline generates a bonus episode where two AI hosts discuss the book: what it argues, why it's worth your time, and what questions to keep in mind. It's a surprisingly good way to decide whether to commit ten hours to a book.</p>
<h2>Cross-language listening</h2>
<p>The pipeline detects the book's language and picks a matching neural voice automatically. There's also a whole-book translation command: feed it an English epub and listen to it as a Chinese audiobook (or configure any language pair your LLM supports).</p>
""",
 faqs=[
 ("Which formats are supported?",
  "epub, txt, and html directly. For mobi/azw3, convert to epub first with Calibre (one click)."),
 ("How natural do the voices sound?",
  "It uses Microsoft's neural voices (the same family behind Edge's Read Aloud), which are close to human narration for most prose. For commercial use you can swap in any TTS provider via a small interface."),
 ("Is this legal?",
  "Converting books you own for personal listening is generally fine. The tool is self-hosted and private by design — your files never leave your own storage."),
 ]),

dict(slug="notebooklm-alternative", short="NotebookLM alternative",
 title="Open-Source NotebookLM Alternative for Audio Overviews",
 desc="Looking for a NotebookLM alternative that's open source and automatic? listenwhilerunning generates two-host audio conversations from your RSS feeds and ebooks on a schedule, delivered as a private podcast feed.",
 h1="An Open-Source NotebookLM Alternative That Runs on a Schedule",
 lede="NotebookLM's Audio Overviews proved that two AI hosts discussing your documents is a genuinely good way to absorb information. But it's manual, closed, and lives inside Google. Here's the self-hosted, always-on version of that idea.",
 body="""
<h2>The core difference: a pipeline, not a button</h2>
<p>With NotebookLM you upload a document, click, wait, and download. Repeat for every document, every day. listenwhilerunning inverts this: you declare your sources once — RSS feeds, subreddits, a folder of ebooks — and a pipeline generates audio on schedule, publishing everything to one private podcast feed your podcast app already follows. New audio just appears.</p>
<h2>Feature comparison</h2>
<ul>
<li><b>Automation:</b> daily cron pipeline vs. manual per-document generation.</li>
<li><b>Delivery:</b> standard podcast RSS (works in Apple Podcasts, lock-screen controls, position sync) vs. in-app playback.</li>
<li><b>Books:</b> whole epubs become serialized audiobooks with an AI intro episode — not a single overview of a document.</li>
<li><b>Openness:</b> AGPL-3.0 source, your own storage and API keys, any OpenAI-compatible LLM. No product to be discontinued out from under you.</li>
<li><b>Cost:</b> Cloudflare free tier + pennies of LLM usage, instead of a Google subscription tier.</li>
</ul>
<h2>What NotebookLM still does better</h2>
<p>Fairness matters: NotebookLM's interactive mode (interrupting the hosts to ask questions) and its deep multi-document grounding are ahead. If you need conversational Q&A over a research corpus, use NotebookLM. If you want your <em>daily information diet</em> turned into audio automatically, that's what this project is for.</p>
""",
 faqs=[
 ("Does it sound like NotebookLM's hosts?",
  "The format is similar — two hosts, natural back-and-forth, disagreements and summaries. Voice quality depends on the TTS you configure; the default neural voices are close to human narration."),
 ("Can I use my own LLM?",
  "Yes. Any OpenAI-compatible endpoint works (OpenRouter, a local model behind a compatible API, etc.). Without an LLM it degrades to plain readout."),
 ("Is there a hosted version if I don't want to self-host?",
  "A hosted version is under evaluation — join the waitlist on the homepage and you'll be notified at launch."),
 ]),

dict(slug="self-hosted-podcast-generator", short="Self-hosted generator",
 title="Self-Hosted Podcast Generator: Your Own AI Audio Pipeline",
 desc="A self-hosted, open-source podcast generator: batch pipeline + object storage + static player, all on free tiers. Your RSS feeds and ebooks become a private AI podcast with no server to maintain.",
 h1="A Self-Hosted Podcast Generator with Zero Servers to Maintain",
 lede="Every consumer 'AI podcast' app that paid for its users' TTS has shut down — Recast, PlayNote, Huxe. The architecture that survives is the one where the pipeline is yours: open source, running on your own free-tier accounts, with no burn rate to kill it.",
 body="""
<h2>Architecture: batch pipeline → object storage → static player</h2>
<p>There is deliberately no backend. A scheduled job (GitHub Actions or cron) fetches your sources, rewrites them with an LLM, synthesizes audio, and uploads everything to object storage. The storage bucket serves a standard podcast RSS feed and a static PWA player. The only dynamic code is a tiny serverless function that writes your settings.</p>
<ul>
<li><b>Storage:</b> Cloudflare R2 — 10GB free, and crucially, free egress (audio is bandwidth-heavy).</li>
<li><b>Compute:</b> GitHub Actions free minutes, or any machine you already have.</li>
<li><b>Player:</b> a static page on Cloudflare Pages, installable as a PWA with offline caching.</li>
</ul>
<h2>Deploy with one command</h2>
<p>Fill two Cloudflare values in <code>.env</code>, then <code>npm run setup</code> creates the bucket, enables the public domain, generates an admin token, deploys the player, and prints your podcast feed URL. The whole thing is idempotent — rerun it anytime.</p>
<h2>Day-2 operations happen in the player</h2>
<p>After setup you shouldn't need a terminal: the player's settings page adds/removes feeds, queues single articles, and accepts ebook uploads (which start converting within minutes). Your phone is the admin console.</p>
""",
 faqs=[
 ("Do I need a VPS?",
  "No. GitHub Actions can run the daily pipeline for free. A VPS only adds faster 'upload → listening' latency via a polling timer (minutes instead of next-day)."),
 ("What are the actual monthly costs?",
  "Storage and bandwidth: $0 on free tiers. LLM: a few cents per day, optional. TTS: free for personal use, swappable for a paid provider if you need commercial rights."),
 ("Why AGPL?",
  "So improvements to hosted deployments flow back to the community. For personal self-hosting AGPL imposes nothing on you."),
 ]),

dict(slug="listen-to-articles-while-running", short="Listen while running",
 title="How to Listen to Articles While Running (Hands-Free Setup)",
 desc="A practical setup for listening to your saved articles and feeds while running: convert them into a private podcast with AI voices, get lock-screen controls, offline caching, and resume — open source.",
 h1="How to Listen to Articles While Running",
 lede="Long runs are perfect for long reads — if the audio experience doesn't fight you. Screen-off playback, glove-friendly controls, offline caching, and picking up exactly where you stopped: here's a setup built around those constraints.",
 body="""
<h2>Why read-aloud apps fall short on a run</h2>
<p>Browser read-aloud and TTS apps assume you're holding the phone: they stop when the screen locks, lose your position, and play one article at a time. Running needs a <em>queue</em> that behaves like a podcast: episodes in order, ±15s skip on the lock screen, and a sleep timer for cooldown walks.</p>
<h2>The setup</h2>
<ol>
<li><b>Route your reading into feeds.</b> Blogs and newsletters have RSS; for one-off articles, paste the URL into the queue and it becomes an episode in minutes.</li>
<li><b>Let the pipeline run at dawn.</b> By the time you lace up, today's episodes — rewritten as a two-host conversation, which survives road noise far better than monotone TTS — are in your podcast app.</li>
<li><b>Go offline-first.</b> The PWA player pre-caches the latest episodes; open it once on Wi-Fi and your run doesn't depend on signal.</li>
<li><b>Books for the long weekend run.</b> Upload an epub and it becomes a serialized audiobook with ~10-minute parts — ideal interval boundaries.</li>
</ol>
<h2>Small things that matter at km 15</h2>
<p>Two alternating voices keep attention better than one. Per-episode summaries let you skip a boring part without fumbling. Resume is per-book and per-episode, so switching between news and a book never loses your place.</p>
""",
 faqs=[
 ("Does it work with a locked screen and watch controls?",
  "Yes — episodes play through your normal podcast app (or the PWA with media-session support), so lock-screen and watch controls work like any podcast."),
 ("What about music alongside articles?",
  "Podcast apps handle this the usual way: pause, play music, resume. Position is kept per episode."),
 ("Can I slow down or speed up narration?",
  "Playback speed is controlled in your podcast app or the built-in player (0.75x–2x)."),
 ]),

dict(slug="ai-audiobook-generator", short="AI audiobook generator",
 title="AI Audiobook Generator — Free, Open Source, Neural Voices",
 desc="Generate audiobooks from your ebooks with an AI pipeline: neural voices, chapter-sized episodes, per-episode summaries, and an AI hosts' intro discussing the book. Free and open source.",
 h1="An AI Audiobook Generator You Actually Own",
 lede="Commercial audiobook generators charge per book or per minute, and their catalog of voices is the product. An open-source pipeline flips that: you bring the book, the AI voices are free for personal use, and the result lands in your podcast app as a proper series.",
 body="""
<h2>What “generate an audiobook” should actually mean</h2>
<p>Feeding a book through TTS is the easy part. What makes the result <em>listenable</em> is structure: chapter-sized episodes (~10 minutes) instead of one 10-hour file, a one-line AI summary on every episode so you can navigate, resume positions that survive app restarts, and delivery through standard podcast RSS so your existing app's speed controls and lock-screen support just work.</p>
<h2>The intro episode: two AI hosts discuss the book</h2>
<p>Before chapter one, the generator produces a bonus episode in which two hosts talk through what the book argues, who it's for, and what questions to keep in mind while listening. It works like a movie trailer for books — several times we've dropped a book after the intro and saved ten hours.</p>
<h2>Speed: listen while it generates</h2>
<p>Generation runs about 10x faster than playback. Upload an epub from your phone and the first episode is ready within minutes; a full 200-page book completes in 2–3 hours in the background while you're already listening.</p>
<h2>Cost breakdown</h2>
<p>Storage: Cloudflare R2 free tier (10GB holds dozens of books, egress is free). Voices: Microsoft neural TTS, free for personal use (swappable for ElevenLabs/Azure if you need commercial rights). Optional LLM for summaries and the intro episode: pennies per book. Total: approximately $0/month.</p>
""",
 faqs=[
 ("Which input formats work?",
  "epub, txt, and html directly; mobi/azw3 convert to epub with one click in Calibre."),
 ("Can it generate the audiobook in a different language than the book?",
  "Yes — there's a whole-book translation command, e.g. listen to an English book as a Chinese audiobook. Voice selection follows the output language automatically."),
 ("How does it compare to paid audiobook generator apps?",
  "Paid apps rent you the pipeline; this one is AGPL open source and runs on your own accounts, so there's no subscription and no service that can shut down and take your library with it."),
 ]),

dict(slug="convert-book-to-audiobook", short="Convert book to audiobook",
 title="How to Convert a Book to an Audiobook (Free, Step by Step)",
 desc="Convert any ebook to an audiobook for free: a step-by-step guide using an open-source AI pipeline with neural voices, chapter episodes, and podcast-app delivery.",
 h1="How to Convert a Book to an Audiobook — Free, Step by Step",
 lede="Most books never get an official audiobook. Here's the practical, zero-subscription way to convert the books you own into listenable audio, using an open-source pipeline and free neural voices.",
 body="""
<h2>Step 1 — Get the book into a supported format</h2>
<p>epub, txt, or html work directly. If your book is mobi/azw3 (Kindle), open it in the free <a href="https://calibre-ebook.com/">Calibre</a> and convert to epub — one click.</p>
<h2>Step 2 — Upload it</h2>
<p>After a one-command setup (<code>npm run setup</code> on any machine with a free Cloudflare account), you get a private web player. Open its settings page on your phone, pick the file, tap upload. That's the whole workflow from then on.</p>
<h2>Step 3 — Start listening in minutes</h2>
<p>Conversion runs ~10x faster than playback: the first ~10-minute episode is ready in a couple of minutes and the rest of the book fills in behind you. Episodes appear in the player and in any podcast app subscribed to your private feed.</p>
<h2>What you get compared to a plain TTS reader</h2>
<ul>
<li>Chapter-sized episodes with AI one-line summaries, not one giant MP3</li>
<li>An AI-generated intro episode where two hosts discuss the book</li>
<li>Resume positions, speed control, sleep timer, offline caching</li>
<li>A standard podcast RSS feed — no proprietary app or format lock-in</li>
</ul>
""",
 faqs=[
 ("Is it really free?",
  "The pipeline is open source (AGPL-3.0) and fits in Cloudflare's free tier; the default neural voices are free for personal use. The only optional cost is pennies of LLM usage for summaries."),
 ("How long does a full book take?",
  "Roughly 2–3 hours for a 200-page book, but you can start listening after the first few minutes."),
 ("Is converting my own books legal?",
  "Format-shifting books you own for personal use is generally considered fine in most jurisdictions. Everything stays in your own private storage."),
 ]),

dict(slug="self-hosted-notebooklm", short="Self-hosted NotebookLM",
 title="Self-Hosted NotebookLM: Audio Overviews on Your Own Infrastructure",
 desc="Run NotebookLM-style two-host audio conversations on your own infrastructure: open source, scheduled, delivered as a private podcast feed. Your keys, your storage, no Google account.",
 h1="A Self-Hosted NotebookLM for Audio Overviews",
 lede="You want NotebookLM's two-AI-hosts-discussing-your-content trick, but on your own infrastructure — your API keys, your storage, no Google account in the loop. That's exactly the shape of this project.",
 body="""
<h2>What self-hosting changes</h2>
<ul>
<li><b>Your models:</b> point it at any OpenAI-compatible endpoint — a cloud LLM, OpenRouter, or a local model behind a compatible API.</li>
<li><b>Your storage:</b> audio and feeds live in your own Cloudflare R2 (or Supabase) bucket. Nothing to export when a product shuts down, because there is no product.</li>
<li><b>Your schedule:</b> instead of clicking per document, a pipeline watches your RSS feeds and book folder and generates audio automatically — every morning, or every 3 minutes for uploads.</li>
</ul>
<h2>Hardware requirements: none</h2>
<p>Unlike self-hosting an LLM, this pipeline is glue, not inference — the heavy lifting is API calls. It runs happily on GitHub Actions' free tier or any $0 leftover machine; there's no GPU, database, or always-on server. <code>npm run setup</code> provisions storage, deploys the player, and prints your private podcast feed URL.</p>
<h2>Honest limits vs. NotebookLM</h2>
<p>No interactive mode (you can't interrupt the hosts to ask questions), and no multi-document research grounding. What you get instead is automation: a daily audio digest of <em>your</em> sources and full audiobooks of your epubs, delivered to a normal podcast app.</p>
""",
 faqs=[
 ("Does it need a GPU or local LLM?",
  "No. It's an orchestration pipeline: TTS and LLM are API calls. You can point it at a local model if you run one, but it's optional."),
 ("Where does the audio live?",
  "In your own object-storage bucket with a private feed URL. Delete the bucket and every trace is gone — it's your data in the most literal sense."),
 ("What's the actual monthly cost?",
  "Storage and compute fit in free tiers; LLM rewriting costs a few cents a day and is optional. Effectively $0."),
 ]),

dict(slug="what-to-listen-to-while-running", short="What to listen to running",
 title="What to Listen to While Running: Beyond the Usual Podcast List",
 desc="Bored of your podcast queue on runs? Practical options — and how runners turn their own RSS feeds, newsletters, and ebooks into fresh daily running audio for free.",
 h1="What to Listen to While Running (When You've Run Out of Podcasts)",
 lede="Every runner hits the wall where the podcast queue is empty, the playlists are stale, and a 90-minute long run looms. Here's a practical tour of the options — including the one most lists miss: audio generated from your own reading backlog.",
 body="""
<h2>The usual suspects, quickly</h2>
<p><b>Podcasts</b> are the default for good reason — but publication schedules don't care about your training plan. <b>Audiobooks</b> are perfect for long runs, if the book has an audio edition and you're willing to pay per title. <b>Music</b> carries intervals but melts into wallpaper on easy runs.</p>
<h2>The option nobody lists: your own feeds, as a podcast</h2>
<p>You already curate the most interesting reading queue in your life — newsletters, blogs, subreddits, saved articles. An open-source pipeline can rewrite each day's new items into a two-host dialogue show with neural voices and push it to your podcast app every morning. Your long-run audio is now generated from whatever you actually care about, and it never runs out.</p>
<h2>And the books without audio editions</h2>
<p>The same pipeline converts your epubs into serialized audiobooks with ~10-minute episodes — natural interval boundaries — plus an AI intro episode discussing the book, so you can decide on the warm-up whether it deserves the whole run.</p>
<h2>Practical tips for run audio</h2>
<ul>
<li>Two alternating voices survive road noise far better than monotone TTS.</li>
<li>Cache offline before you leave — the player pre-fetches the latest episodes on Wi-Fi.</li>
<li>±15s lock-screen skip matters more than any other control at km 15.</li>
</ul>
""",
 faqs=[
 ("What's the best thing to listen to on a long run?",
  "Content you're genuinely curious about beats content optimized for running. Serialized audiobooks and your own feeds work well because there's always a next episode."),
 ("How do I listen to articles while running?",
  "Convert them into a private podcast feed: an open-source pipeline rewrites your saved articles into dialogue audio and delivers them to your podcast app, hands-free."),
 ("Is generated audio good enough for running?",
  "Modern neural voices in a two-host format are close to human narration, and road conditions actually mask the remaining difference."),
 ]),

dict(slug="pdf-to-audiobook", short="PDF to audiobook",
 title="PDF to Audiobook: Convert Any PDF to Audio, Free & Open Source",
 desc="Turn a PDF into an audiobook with neural AI voices: upload from your phone, get chapter-sized episodes with AI summaries, start listening in minutes. Free, open source, no per-book fees.",
 h1="PDF to Audiobook — Free, With Natural AI Voices",
 lede="Reports, papers, and half the books people actually own live in PDF. Converting a PDF to an audiobook shouldn't mean a subscription or a robotic voice — here's the free, open-source way that produces a real listenable series.",
 body="""
<h2>How the conversion works</h2>
<ol>
<li><b>Text extraction:</b> the pipeline pulls the text layer out of your PDF, strips page-number noise, and normalizes paragraphs. (Scanned PDFs without a text layer need OCR first — the tool tells you instead of producing silence.)</li>
<li><b>Chunking:</b> the text is split into ~10-minute episodes at sentence boundaries, each with a one-line AI summary so the series is navigable.</li>
<li><b>Synthesis:</b> neural voices (the family behind Edge's Read Aloud) render each episode; an AI-generated intro episode has two hosts discuss what the document argues.</li>
<li><b>Delivery:</b> everything lands in your private podcast feed and a PWA player — resume positions, speed control, offline caching.</li>
</ol>
<h2>Start listening in minutes</h2>
<p>Generation runs about 10x faster than playback: upload a PDF from your phone's browser and the first episode is ready before you've laced your shoes; a 300-page PDF finishes in the background while you listen.</p>
<h2>Why not a "PDF reader" app?</h2>
<p>Read-aloud apps play one document while the screen is on, and lose your place when it locks. A podcast-feed pipeline gives you lock-screen controls, per-episode resume, and a queue — the difference between "text to speech" and an actual audiobook.</p>
""",
 faqs=[
 ("Does it work with scanned PDFs?",
  "Not directly — scanned pages have no text layer. Run OCR first (e.g. with ocrmypdf), then upload the result."),
 ("Are equations, tables, and footnotes handled?",
  "They're read as text, which works for prose-heavy documents. Heavily mathematical papers are better skimmed visually and listened to for the prose sections."),
 ("What does it cost?",
  "Nothing per book: the pipeline is AGPL open source, storage fits Cloudflare's free tier, and the default neural voices are free for personal use."),
 ]),

dict(slug="epub-to-mp3", short="Epub to MP3",
 title="Epub to MP3: Convert an Ebook to MP3 Audio Files, Free",
 desc="Convert epub to MP3 with neural AI voices, free and open source. Get one MP3 per chapter-sized episode, playable anywhere, plus a private podcast feed for your phone.",
 h1="Epub to MP3 — One Clean Audio File per Chapter",
 lede="Sometimes you don't want an app — you want MP3 files. This open-source pipeline converts an epub into a series of ~10-minute MP3s with natural neural voices, stored in your own bucket where you can download, sync, or podcast them.",
 body="""
<h2>What you get</h2>
<p>Each book becomes <code>bookaudio/&lt;id&gt;/1.mp3, 2.mp3, …</code> in your own object storage — 96kbps mono, sentence-boundary splits, roughly 10 minutes per file. They're plain MP3s: copy them to a watch, an old iPod, a car USB stick, anything.</p>
<h2>But the podcast feed is the better interface</h2>
<p>The same files are also published to a private podcast RSS feed with episode titles, AI-generated per-episode summaries, and an intro episode where two AI hosts discuss the book. Subscribe once in any podcast app and you get resume positions and lock-screen controls for free — worth trying before you go file-management mode.</p>
<h2>Voice quality</h2>
<p>The default voices are Microsoft's neural TTS — the same family as Edge's Read Aloud — which handle long-form prose with natural pacing and are free for personal use. Language is auto-detected per book, and you can pick any voice from the catalog.</p>
""",
 faqs=[
 ("Can I just download the MP3s?",
  "Yes — they're regular files in your own Cloudflare R2 bucket with public URLs. No DRM, no app lock-in."),
 ("How big are the files?",
  "About 5MB per 10-minute episode at 96kbps mono; a full book is typically 300–600MB, and R2's free tier holds 10GB."),
 ("What about mobi or PDF?",
  "PDF works directly; mobi/azw3 convert to epub first with Calibre (one click)."),
 ]),

dict(slug="free-audiobook-maker", short="Free audiobook maker",
 title="Free Audiobook Maker: Make Your Own Audiobooks with AI Voices",
 desc="A genuinely free audiobook maker: open source, neural AI voices, no per-book fees or watermarks. Make your own audiobooks from epub, PDF, or text and listen in any podcast app.",
 h1="A Genuinely Free Audiobook Maker (No Trial, No Per-Book Fees)",
 lede="Most ”free audiobook makers” are trials: a few thousand characters, then a subscription. This one is free the way open source is free — you run the pipeline on your own free-tier accounts, and there's simply nobody to bill you.",
 body="""
<h2>Why it can be actually free</h2>
<p>Audiobook-maker apps pay for TTS compute on your behalf, so they must charge you. This project inverts the model: the pipeline is AGPL open source and runs on <em>your</em> accounts — Cloudflare R2's free 10GB for storage, free-for-personal-use neural voices for synthesis, optional pennies of LLM for summaries. There is no company in the loop with a burn rate.</p>
<h2>Making your first audiobook</h2>
<ol>
<li><code>npm run setup</code> once (two Cloudflare values in .env, one command, ~2 minutes).</li>
<li>Upload an epub/PDF/txt from the player's settings page on your phone.</li>
<li>Listen: the first ~10-minute episode is ready in minutes, the rest of the book generates behind you.</li>
</ol>
<h2>What makes the output good</h2>
<p>Chapter-sized episodes with AI one-line summaries; an intro episode where two AI hosts discuss the book; automatic language detection and voice switching; whole-book translation if you want to listen in another language; resume positions everywhere via standard podcast RSS.</p>
""",
 faqs=[
 ("Is there a catch — watermarks, limits, upsells?",
  "No. AGPL-3.0 source, your own storage and keys. The only genuinely optional cost is LLM usage for summaries (cents)."),
 ("Do I need to know how to code?",
  "You need to run three commands in a terminal once. After that, everything happens in the web player."),
 ("Can I use the audiobooks commercially?",
  "The pipeline is AGPL and fine to use; the default free TTS voices are personal-use only — swap in a commercial TTS provider (interface provided) for commercial audio."),
 ]),

dict(slug="audiobooks-for-running", short="Audiobooks for running",
 title="Audiobooks for Running: The Setup That Makes Long Runs Fly",
 desc="Audiobooks are the best long-run companion — if the setup is right. Episode-sized chapters, lock-screen controls, offline caching, and how to turn your own ebooks into running audiobooks for free.",
 h1="Audiobooks for Running: Make Long Runs Something You Look Forward To",
 lede="Music carries intervals; podcasts carry easy days; but nothing eats a 2-hour long run like a book you can't put down. The catch is logistics: chapter length, resume, offline, and where the audiobooks come from. Here's the setup that solves all four.",
 body="""
<h2>Why audiobooks beat podcasts on long runs</h2>
<p>A long run wants continuity, not context-switching. With a book, kilometer 18 has narrative momentum behind it — you keep running because you want the next chapter. Runners' folk wisdom, now with a practical setup.</p>
<h2>The four logistics problems, solved</h2>
<ul>
<li><b>Chapter length:</b> ~10-minute episodes are natural interval boundaries and make "one more part" psychology work for you.</li>
<li><b>Resume:</b> per-episode and per-book positions that survive app restarts and phone switches (standard podcast RSS does this for free).</li>
<li><b>Offline:</b> the PWA player pre-caches upcoming episodes on Wi-Fi; airplane-mode long runs just work.</li>
<li><b>Supply:</b> most books never get an audiobook edition — so generate your own. An open-source pipeline converts your epubs/PDFs into serialized audiobooks with natural neural voices, free.</li>
</ul>
<h2>Picking books that run well</h2>
<p>Narrative nonfiction and memoirs pace beautifully at easy-run heart rates. Dense technical books work better with the AI intro episode first — two hosts discuss what the book argues, so you can decide on the warm-up whether it deserves the whole long run.</p>
""",
 faqs=[
 ("What audiobooks are best for running?",
  "Anything with narrative pull — memoirs, narrative nonfiction, thrillers. Save dense reference books for the desk."),
 ("How do I get audiobooks for books that don't have one?",
  "Convert your own ebooks: an open-source pipeline turns epub/PDF into a serialized audiobook with neural voices and delivers it to your podcast app."),
 ("Wired or bone-conduction headphones?",
  "For roads, open-ear (bone conduction) keeps you aware of traffic; audiobooks' spoken voice cuts through better than music there."),
 ]),

dict(slug="notebooklm-open-source", short="NotebookLM open source",
 title="NotebookLM Open Source: The Self-Hosted Audio Overview Stack",
 desc="Looking for an open-source NotebookLM? This AGPL stack generates two-host audio conversations from your feeds and books on a schedule, with your own LLM and storage.",
 h1="An Open-Source NotebookLM (for the Audio Overview Part)",
 lede="”NotebookLM open source” usually means one of two wishes: audit the pipeline that turns text into a two-host conversation, or run it with your own models and storage. This project delivers both — for the audio-overview workflow specifically.",
 body="""
<h2>What's actually in the stack</h2>
<ul>
<li><b>Script generation:</b> a dialogue prompt (fully editable — it's just a file) that turns an article or book sample into a two-host script with disagreements, questions, and summaries. Works with any OpenAI-compatible LLM, including local models behind a compatible API.</li>
<li><b>Synthesis:</b> two distinct neural voices, alternating naturally; swap the TTS provider via one interface.</li>
<li><b>Automation:</b> a cron pipeline watches your RSS feeds and book folder — audio appears daily without clicking anything.</li>
<li><b>Delivery:</b> standard private podcast RSS + a PWA player. AGPL-3.0, ~1500 lines of TypeScript you can read in an afternoon.</li>
</ul>
<h2>What it deliberately doesn't clone</h2>
<p>NotebookLM's interactive Q&amp;A and multi-document research grounding aren't here — this is the <em>listening pipeline</em>, not the research notebook. If your use case is "my daily reading, as audio, automatically," the open-source version is arguably better; if it's "interrogate 40 PDFs," use NotebookLM.</p>
<h2>Read the prompt, change the show</h2>
<p>Because the dialogue prompt is a plain file, you can change the hosts' personalities, language, or format in one edit — something no closed product lets you do.</p>
""",
 faqs=[
 ("Which LLMs work?",
  "Any OpenAI-compatible /chat/completions endpoint: cloud providers, OpenRouter, or a local model. Without one, episodes fall back to plain readout."),
 ("Is the audio quality comparable to NotebookLM?",
  "The format (two hosts, natural back-and-forth) is the same; voice quality depends on your TTS choice. The default neural voices are close; ElevenLabs via the provider interface gets closer."),
 ("Why AGPL and not MIT?",
  "So hosted forks must share improvements back. For personal self-hosting it changes nothing."),
 ]),

dict(slug="notebooklm-audio-overview", short="Audio Overview explained",
 title="NotebookLM Audio Overview: How It Works & How to Automate It",
 desc="What NotebookLM's Audio Overview actually does, its limits, and how to get the same two-host audio automatically for your RSS feeds and ebooks with an open-source pipeline.",
 h1="NotebookLM Audio Overview, Explained — and Automated",
 lede="Audio Overview is NotebookLM's breakout feature: two AI hosts discuss your document like a podcast segment. Here's what's going on under the hood, where the manual workflow gets tedious, and how to make the same trick run itself.",
 body="""
<h2>What Audio Overview does</h2>
<p>Given your sources, NotebookLM writes a two-host dialogue script — question, pushback, recap — and synthesizes it with a paired voice set. The dialogue format is the magic: disagreement and questions keep your attention in a way single-voice TTS never does.</p>
<h2>Where the manual loop breaks down</h2>
<p>Each overview is one click… per document, per day. Your reading is a <em>stream</em> — feeds, newsletters, saved articles, books — and clicking "generate" for each item forever is a chore that quietly kills the habit.</p>
<h2>The automated version</h2>
<p>An open-source pipeline applies the same recipe on a schedule: every morning it fetches your RSS feeds, writes two-host dialogue scripts with your LLM, synthesizes neural audio, and publishes to a private podcast feed. Books get the treatment too — a whole epub becomes a serialized audiobook with a hosts-discuss-the-book intro episode. You subscribe once; audio appears forever.</p>
<h2>When to use which</h2>
<p>Use NotebookLM when you need interactive Q&amp;A over a document set. Use the pipeline when the job is "turn my daily information diet into audio without me doing anything."</p>
""",
 faqs=[
 ("Can I get Audio Overviews for RSS feeds in NotebookLM?",
  "Not automatically — NotebookLM works per-notebook, per-source, manually. Scheduled feed-to-audio is exactly the gap the open-source pipeline fills."),
 ("Does the automated version sound like NotebookLM?",
  "Same two-host format and pacing; voices depend on the TTS you configure (default: Microsoft neural voices, free for personal use)."),
 ("Is my content sent to Google?",
  "No — the pipeline runs on your accounts with your chosen LLM endpoint and your own storage."),
 ]),
]

out = pathlib.Path(__file__).parent / "public"
for p in PAGES:
    (out / (p["slug"] + ".html")).write_text(render(p, PAGES), encoding="utf8")
    print("wrote", p["slug"] + ".html")

# sitemap + robots
urls = [f"{BASE}/"] + [f"{BASE}/{p['slug']}" for p in PAGES] + [f"{BASE}/zh"]
sm = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
sm += "".join(f"  <url><loc>{u}</loc></url>\n" for u in urls) + "</urlset>\n"
(out / "sitemap.xml").write_text(sm, encoding="utf8")
(out / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {BASE}/sitemap.xml\n", encoding="utf8")
print("wrote sitemap.xml, robots.txt")
