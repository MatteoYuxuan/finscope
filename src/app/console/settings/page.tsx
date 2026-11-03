"use client";

import { useEffect, useState } from "react";
import { Bot, CheckCircle2, Database, Download, Eye, RefreshCw, Settings2, ShieldCheck, TriangleAlert } from "lucide-react";
import { Badge, Button, Card, CardHead, ErrorBanner, Field, InfoNote, Input, SectionHeading, Select } from "@/components/ui";
import { apiGet, apiSend, errorText } from "@/lib/client/api";

interface LlmConfig {
  base_url: string;
  model: string;
  api_key_masked: string;
  configured: boolean;
  vision_base_url: string;
  vision_model: string;
  vision_api_key_masked: string;
  vision_configured: boolean;
}
interface Health {
  quant: { status: string; version: string; llm_configured: boolean; vision_configured?: boolean; data?: Record<string, unknown> } | null;
  quantError: string | null;
  counts: { assets: number; liabilities: number; goals: number; runs: number; reports: number };
  checkedAt: string;
}

export default function SettingsPage() {
  const [llm, setLlm] = useState<LlmConfig | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [form, setForm] = useState({ base_url: "", model: "", api_key: "", vision_base_url: "", vision_model: "", vision_api_key: "" });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const [llmResponse, healthResponse] = await Promise.all([
        apiGet<LlmConfig>("/api/settings/llm"),
        apiGet<Health>("/api/system/health"),
      ]);
      setLlm(llmResponse.data);
      setHealth(healthResponse.data);
      setForm((current) => ({
        ...current,
        base_url: current.base_url || llmResponse.data.base_url,
        model: current.model || llmResponse.data.model,
        vision_base_url: current.vision_base_url || llmResponse.data.vision_base_url,
        vision_model: current.vision_model || llmResponse.data.vision_model,
      }));
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload: Record<string, string> = {};
      for (const [key, value] of Object.entries(form)) if (value.trim()) payload[key] = value.trim();
      await apiSend<LlmConfig>("/api/settings/llm", "POST", payload);
      setNotice("配置已保存。立即生效，无需重启服务。");
      setForm((current) => ({ ...current, api_key: "", vision_api_key: "" }));
      await load();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setError("");
    setNotice("");
    try {
      const response = await apiSend<{ ok: boolean; reply: string; model: string }>("/api/settings/llm/test", "POST");
      setNotice(`连接成功：模型 ${response.data.model} 返回「${response.data.reply}」。`);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setTesting(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    setError("");
    setNotice("");
    try {
      const response = await apiSend<{ series: number; rows: number; data_end: string; quotes: number }>("/api/market/refresh", "POST");
      setNotice(`数据刷新完成：${response.data.series} 个资产、${response.data.rows} 行、最新交易日 ${response.data.data_end}、${response.data.quotes} 条报价。`);
      await load();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setRefreshing(false);
    }
  }

  async function resetDemo() {
    if (!window.confirm("恢复演示数据会清空当前持仓、目标、运行记录与报告，确定继续？")) return;
    setResetting(true);
    setError("");
    setNotice("");
    try {
      await apiSend("/api/demo/reset", "POST");
      setNotice("演示数据已恢复。");
      await load();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setResetting(false);
    }
  }

  return (
    <div>
      <SectionHeading
        eyebrow="Settings"
        title="设置"
        desc="模型接入、数据缓存与本地数据管理。所有业务数据保存在本机，不上传。"
        right={<Badge tone={health?.quant ? "brand" : "danger"}>{health?.quant ? "量化服务在线" : "量化服务离线"}</Badge>}
      />
      {error ? <div className="mb-3"><ErrorBanner message={error} onRetry={load} /></div> : null}
      {notice ? <p className="mb-3 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2 text-xs text-brand-800">{notice}</p> : null}

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHead title="LLM 接入" desc="OpenAI 兼容接口。Key 只保存在本机 data/llm.json，不会写日志。" right={<Bot className="h-4 w-4 text-brand-600" />} />
          <div className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-2">
            <Field label="BASE_URL" hint="例如 https://api.deepseek.com 或 https://dashscope.aliyuncs.com/compatible-mode/v1">
              <Input value={form.base_url} onChange={(event) => setForm({ ...form, base_url: event.target.value })} placeholder="https://api.deepseek.com" />
            </Field>
            <Field label="模型名">
              <Input value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} placeholder="deepseek-chat" />
            </Field>
            <Field label="API Key" hint={llm?.api_key_masked ? `当前：${llm.api_key_masked}；留空表示不修改` : "尚未配置"}>
              <Input type="password" value={form.api_key} onChange={(event) => setForm({ ...form, api_key: event.target.value })} placeholder="sk-…" autoComplete="off" />
            </Field>
            <div className="flex items-end gap-2">
              <Button onClick={save} loading={saving}>保存配置</Button>
              <Button variant="secondary" onClick={test} loading={testing}>测试连接</Button>
            </div>
          </div>
          <div className="border-t border-ink-100 px-5 py-4">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink-700"><Eye className="h-3.5 w-3.5" />视觉模型（可选）</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="视觉 BASE_URL" hint="留空则复用上面的 BASE_URL">
                <Input value={form.vision_base_url} onChange={(event) => setForm({ ...form, vision_base_url: event.target.value })} placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" />
              </Field>
              <Field label="视觉模型名">
                <Input value={form.vision_model} onChange={(event) => setForm({ ...form, vision_model: event.target.value })} placeholder="qwen-vl-max / gpt-4o" />
              </Field>
              <Field label="视觉 API Key" hint={llm?.vision_api_key_masked ? `当前：${llm.vision_api_key_masked}` : "尚未配置"}>
                <Input type="password" value={form.vision_api_key} onChange={(event) => setForm({ ...form, vision_api_key: event.target.value })} placeholder="留空复用主 Key" autoComplete="off" />
              </Field>
            </div>
          </div>
        </Card>

        <div className="space-y-3">
          <Card>
            <CardHead title="运行状态" desc="量化服务与本机数据。" right={<Database className="h-4 w-4 text-ink-400" />} />
            <div className="space-y-2 px-4 py-4 text-[11px]">
              <Row label="量化服务" value={health?.quant ? `在线 · v${health.quant.version}` : health?.quantError ? "离线" : "检查中"} tone={health?.quant ? "brand" : "danger"} />
              <Row label="LLM" value={llm?.configured ? `${llm.model}` : "未配置（规则模式）"} tone={llm?.configured ? "brand" : "warn"} />
              <Row label="视觉模型" value={llm?.vision_configured ? llm.vision_model || "已配置" : "未配置"} tone={llm?.vision_configured ? "brand" : "warn"} />
              <Row label="持仓 / 负债" value={`${health?.counts.assets ?? "—"} / ${health?.counts.liabilities ?? "—"}`} />
              <Row label="目标 / 运行" value={`${health?.counts.goals ?? "—"} / ${health?.counts.runs ?? "—"}`} />
              <Row label="数据行" value={String(health?.quant?.data?.["510300_rows"] ?? health?.quant?.data?.last_date ?? "—")} />
            </div>
          </Card>

          <Card>
            <CardHead title="数据缓存" desc="演示前预热行情，避免现场等待。" right={<RefreshCw className="h-4 w-4 text-ink-400" />} />
            <div className="px-4 py-4">
              <Button size="sm" variant="secondary" onClick={refresh} loading={refreshing}>刷新真实行情与宏观</Button>
              <p className="mt-2 text-[10px] leading-relaxed text-ink-400">首次拉取约 30–60 秒；缓存后分析更快。断网时自动使用本地缓存。</p>
            </div>
          </Card>

          <Card>
            <CardHead title="演示与合规" desc="本地单用户工具。" right={<ShieldCheck className="h-4 w-4 text-brand-600" />} />
            <div className="space-y-2 px-4 py-4 text-[11px] leading-relaxed text-ink-500">
              <p className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" />不推荐个股、不给目标价、不承诺收益。</p>
              <p className="flex gap-2"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />示例持仓为虚构数据，请勿填入真实敏感信息。</p>
              <p className="flex gap-2"><Download className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" />报告可在「研报与记录」下载 PDF。</p>
              <Button size="sm" variant="secondary" onClick={resetDemo} loading={resetting}>恢复演示数据</Button>
            </div>
          </Card>
        </div>
      </div>

      <div className="mt-3">
        <InfoNote>
          如果量化服务离线：在项目根目录执行 <code className="rounded bg-white px-1">npm run quant:dev</code>，或使用 <code className="rounded bg-white px-1">npm run start:easy</code> 同时启动前后端。
        </InfoNote>
      </div>
    </div>
  );
}

function Row({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "brand" | "warn" | "danger" | "neutral" }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-ink-50 pb-1.5 last:border-0 last:pb-0">
      <span className="text-ink-500">{label}</span>
      <span className={tone === "brand" ? "font-medium text-brand-700" : tone === "warn" ? "font-medium text-amber-700" : tone === "danger" ? "font-medium text-red-600" : "text-ink-700"}>{value}</span>
    </div>
  );
}
