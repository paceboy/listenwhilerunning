// Newsletter → 播客的收件端:解析邮件正文,写 JSON 到私有桶 inbox/,
// 服务器管线(poll/每日批次)消费后转成播客集并删除。
import PostalMime from "postal-mime";

export default {
  async email(message, env) {
    const mail = await PostalMime.parse(message.raw);
    // 优先纯文本;只有 HTML 时粗提取(去 script/style/标签)
    let text = (mail.text || "").trim();
    if (text.length < 200 && mail.html) {
      text = mail.html
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)) // Substack/Mailchimp 满篇 &#8217; 弯引号
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&amp;/g, "&") // 必须最后:先解会把 &amp;lt; 双重解码成 <
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }
    if (text.length < 100) return; // 空邮件/纯图邮件,忽略
    const item = {
      subject: mail.subject || "(no subject)",
      from: (mail.from && (mail.from.name || mail.from.address)) || "newsletter",
      date: new Date().toISOString(),
      text: text.slice(0, 60000),
    };
    const key = `inbox/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.json`;
    await env.INBOX.put(key, JSON.stringify(item), {
      httpMetadata: { contentType: "application/json" },
    });
  },
};
