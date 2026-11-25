'use client';

import React, { useState, useEffect, useMemo } from 'react';

interface WorkHistoryEntry {
  id: string;
  date: string;
  title: string;
  members: string;
  note: string;
}

interface KoubanSiteItem {
  site_key: string;
  site_name: string;
  kouban_no: string;
  prime_contractor: string;
  client_name: string;
  dispatch_start: string;
  dispatch_end: string;
  dispatch_members: string[];
  note: string;
  work_history: WorkHistoryEntry[];
  created_at: number;
  isUnorganized?: boolean;
}

interface IntegrationSettings {
  syncUrl: string;
  mamezuAppUrl: string;
  healthAppUrl: string;
  fieldnoteAppUrl: string;
  ledgerAppUrl: string;
  memoAppUrl: string;
}

const STORAGE_KEY_SITES = 'genba_kouban_sites_v1';
const STORAGE_KEY_SETTINGS = 'genba_kouban_settings_v1';

function generateNewSiteKey(): string {
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate()
  ).padStart(2, '0')}`;
  const rand = Math.random().toString(36).slice(2, 6);
  return `site_${ymd}_${rand}`;
}

export default function KoubanManagerPage() {
  const [sites, setSites] = useState<KoubanSiteItem[]>([]);
  const [settings, setSettings] = useState<IntegrationSettings>({
    syncUrl: '',
    mamezuAppUrl: '',
    healthAppUrl: '',
    fieldnoteAppUrl: '',
    ledgerAppUrl: '',
    memoAppUrl: '',
  });
  const [draftSettings, setDraftSettings] = useState<IntegrationSettings>(settings);

  // フィルタ・検索・タブ
  const [activeTab, setActiveTab] = useState<'all' | 'unorganized' | 'active'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [banner, setBanner] = useState<{ type: 'ok' | 'warn'; text: string } | null>(null);

  // モーダル管理
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [editingSite, setEditingSite] = useState<KoubanSiteItem | null>(null);
  const [newMemberText, setNewMemberText] = useState('');
  const [newHistoryDate, setNewHistoryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newHistoryTitle, setNewHistoryTitle] = useState('');
  const [newHistoryMembers, setNewHistoryMembers] = useState('');
  const [newHistoryNote, setNewHistoryNote] = useState('');
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);

  // 初回ロード（端末保存データ ＆ 他アプリ保存済み現場キーの自動検出）
  useEffect(() => {
    try {
      const savedCfg = localStorage.getItem(STORAGE_KEY_SETTINGS);
      let loadedSettings: IntegrationSettings = {
        syncUrl: '',
        mamezuAppUrl: '',
        healthAppUrl: '',
        fieldnoteAppUrl: '',
        ledgerAppUrl: '',
        memoAppUrl: '',
      };
      if (savedCfg) {
        loadedSettings = { ...loadedSettings, ...JSON.parse(savedCfg) };
      }

      // 他アプリで保存済みのサーバーURLがあれば補助検出
      if (!loadedSettings.syncUrl) {
        for (const k of [
          'mamezu_studio_cloud_cfg_v1',
          'genba_cloud_sync_config_v1',
          'genba_fieldnote_cloud_sync_v1',
        ]) {
          const raw = localStorage.getItem(k);
          if (raw) {
            const p = JSON.parse(raw);
            const u = p.apiUrl || p.activeUrl || '';
            if (u) {
              loadedSettings.syncUrl = u;
              break;
            }
          }
        }
      }
      setSettings(loadedSettings);
      setDraftSettings(loadedSettings);

      const savedSitesRaw = localStorage.getItem(STORAGE_KEY_SITES);
      const initialList: KoubanSiteItem[] = savedSitesRaw ? JSON.parse(savedSitesRaw) : [];
      setSites(Array.isArray(initialList) ? initialList : []);
    } catch {
      // ignore
    }
  }, []);

  const persistSites = (next: KoubanSiteItem[]) => {
    setSites(next);
    try {
      localStorage.setItem(STORAGE_KEY_SITES, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const persistSettings = (next: IntegrationSettings) => {
    setSettings(next);
    setDraftSettings(next);
    try {
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  // 共通同期サーバー（genba-sync）から現場一覧を取得して統合
  const handlePullFromCloud = async (targetUrl?: string) => {
    const base = (targetUrl ?? settings.syncUrl).trim().replace(/\/+$/, '');
    if (!base) {
      setBanner({
        type: 'warn',
        text: '先に右上の「⚙️ 連携設定」から共通同期サーバーURLを入力してください。',
      });
      return;
    }

    setSyncing(true);
    setBanner(null);
    try {
      const res = await fetch(`${base}/api/sites`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data?.ok || !Array.isArray(data.sites)) {
        throw new Error(data?.error || `サーバー応答エラー (HTTP ${res.status})`);
      }

      const mergedMap = new Map<string, KoubanSiteItem>();
      sites.forEach((s) => mergedMap.set(s.site_key, s));

      let newCount = 0;
      data.sites.forEach((row: Record<string, unknown>) => {
        const sk = String(row.site_key || '').trim();
        if (!sk || sk === 'COMMON_SHARED_POOL') return;
        const existing = mergedMap.get(sk);
        const koubanNo = String(row.kouban_no || existing?.kouban_no || '').trim();
        const prime = String(
          row.prime_contractor ?? row.contractor ?? existing?.prime_contractor ?? ''
        ).trim();
        const client = String(row.client_name ?? existing?.client_name ?? '').trim();
        const members = Array.isArray(row.dispatch_members)
          ? (row.dispatch_members as string[])
          : existing?.dispatch_members || [];
        const history = Array.isArray(row.work_history)
          ? (row.work_history as WorkHistoryEntry[])
          : existing?.work_history || [];

        if (!existing) newCount++;

        mergedMap.set(sk, {
          site_key: sk,
          site_name: String(row.site_name || existing?.site_name || sk).trim(),
          kouban_no: koubanNo,
          prime_contractor: prime,
          client_name: client,
          dispatch_start: String(row.dispatch_start ?? existing?.dispatch_start ?? '').trim(),
          dispatch_end: String(row.dispatch_end ?? existing?.dispatch_end ?? '').trim(),
          dispatch_members: members,
          note: String(row.note ?? existing?.note ?? '').trim(),
          work_history: history,
          created_at: Number(row.created_at || existing?.created_at || Date.now()),
          isUnorganized: !koubanNo && !prime && !client,
        });
      });

      const mergedList = Array.from(mergedMap.values()).sort(
        (a, b) => (b.created_at || 0) - (a.created_at || 0)
      );
      persistSites(mergedList);
      setBanner({
        type: 'ok',
        text: `☁️ クラウドから現場データを同期しました（全 ${mergedList.length} 件 ／ 新規検出 ${newCount} 件）`,
      });
    } catch (err: unknown) {
      setBanner({
        type: 'warn',
        text: `⚠️ 同期エラー: ${err instanceof Error ? err.message : '通信に失敗しました'}`,
      });
    } finally {
      setSyncing(false);
    }
  };

  // 編集した現場・工番情報を端末＆クラウドへ保存
  const handleSaveEditingSite = async () => {
    if (!editingSite) return;
    const cleanKey = editingSite.site_key.trim() || generateNewSiteKey();
    const cleanName = editingSite.site_name.trim() || cleanKey;
    const updatedItem: KoubanSiteItem = {
      ...editingSite,
      site_key: cleanKey,
      site_name: cleanName,
      isUnorganized:
        !editingSite.kouban_no.trim() &&
        !editingSite.prime_contractor.trim() &&
        !editingSite.client_name.trim(),
    };

    const nextList = [...sites];
    const idx = nextList.findIndex((s) => s.site_key === cleanKey);
    if (idx >= 0) nextList[idx] = updatedItem;
    else nextList.unshift(updatedItem);

    persistSites(nextList);
    setEditingSite(null);

    const base = settings.syncUrl.trim().replace(/\/+$/, '');
    if (base) {
      try {
        const res = await fetch(`${base}/api/sites/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            site_key: updatedItem.site_key,
            site_name: updatedItem.site_name,
            kouban_no: updatedItem.kouban_no,
            prime_contractor: updatedItem.prime_contractor,
            contractor: updatedItem.prime_contractor,
            client_name: updatedItem.client_name,
            dispatch_start: updatedItem.dispatch_start,
            dispatch_end: updatedItem.dispatch_end,
            dispatch_members: updatedItem.dispatch_members,
            note: updatedItem.note,
            work_history: updatedItem.work_history,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setBanner({
          type: 'ok',
          text: `✅ 「${updatedItem.site_name}」を端末とクラウドに保存しました`,
        });
      } catch (err: unknown) {
        setBanner({
          type: 'warn',
          text: `端末には保存しましたが、クラウド送信でエラーが発生しました: ${
            err instanceof Error ? err.message : ''
          }`,
        });
      }
    } else {
      setBanner({
        type: 'ok',
        text: `💾 「${updatedItem.site_name}」を端末に保存しました`,
      });
    }
  };

  const handleDeleteSite = async (siteKey: string) => {
    setConfirmDeleteKey(null);
    const nextList = sites.filter((s) => s.site_key !== siteKey);
    persistSites(nextList);

    const base = settings.syncUrl.trim().replace(/\/+$/, '');
    if (base) {
      try {
        await fetch(`${base}/api/sites?site_key=${encodeURIComponent(siteKey)}`, {
          method: 'DELETE',
        });
      } catch {
        // ignore
      }
    }
    setBanner({ type: 'ok', text: `🗑️ 現場（${siteKey}）を削除しました` });
  };

  // JSONバックアップ出力・復元
  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), sites }, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kouban_sites_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '{}'));
        const list = Array.isArray(parsed?.sites) ? parsed.sites : Array.isArray(parsed) ? parsed : [];
        if (list.length === 0) throw new Error('有効なデータが見つかりません');
        persistSites(list);
        setBanner({ type: 'ok', text: `📂 ${list.length} 件の工番・現場データを読み込みました` });
      } catch (err: unknown) {
        setBanner({
          type: 'warn',
          text: `⚠️ 読込エラー: ${err instanceof Error ? err.message : '形式不正'}`,
        });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // 他アプリを開くヘルパー
  const openRelatedApp = (baseUrl: string, site: KoubanSiteItem, appLabel: string) => {
    const clean = baseUrl.trim().replace(/\/+$/, '');
    if (!clean) {
      setBanner({
        type: 'warn',
        text: `「⚙️ 連携設定」で ${appLabel} のURLを設定すると直接開けます（現場キー: ${site.site_key}）`,
      });
      return;
    }
    const sep = clean.includes('?') ? '&' : '?';
    window.open(
      `${clean}${sep}site_key=${encodeURIComponent(site.site_key)}&site_name=${encodeURIComponent(
        site.site_name
      )}`,
      '_blank',
      'noopener,noreferrer'
    );
  };

  // 絞り込み済み一覧
  const filteredSites = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const q = searchQuery.trim().toLowerCase();

    return sites.filter((s) => {
      const unorg = !s.kouban_no.trim() && !s.prime_contractor.trim() && !s.client_name.trim();
      if (activeTab === 'unorganized' && !unorg) return false;
      if (activeTab === 'active') {
        if (s.dispatch_end && s.dispatch_end < todayStr) return false;
      }
      if (!q) return true;
      return (
        s.site_name.toLowerCase().includes(q) ||
        s.kouban_no.toLowerCase().includes(q) ||
        s.prime_contractor.toLowerCase().includes(q) ||
        s.client_name.toLowerCase().includes(q) ||
        s.site_key.toLowerCase().includes(q) ||
        s.dispatch_members.some((m) => m.toLowerCase().includes(q))
      );
    });
  }, [sites, activeTab, searchQuery]);

  const unorganizedCount = useMemo(
    () =>
      sites.filter((s) => !s.kouban_no.trim() && !s.prime_contractor.trim() && !s.client_name.trim())
        .length,
    [sites]
  );

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 pb-16">
      {/* ヘッダー */}
      <header className="bg-slate-900 text-white px-4 py-3.5 shadow-md sticky top-0 z-30">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-base sm:text-lg font-extrabold tracking-tight flex items-center gap-2">
              <span>🏗️</span>
              <span>工番・現場管理ハブ</span>
              <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-slate-800 text-cyan-300 border border-slate-700">
                全 {sites.length} 現場
              </span>
            </h1>
            <p className="text-[11px] text-slate-400">
              工番・元請け・顧客・出向者・履歴の一元整理 ＆ 各現場アプリ連携
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={() =>
                setEditingSite({
                  site_key: generateNewSiteKey(),
                  site_name: '',
                  kouban_no: '',
                  prime_contractor: '',
                  client_name: '',
                  dispatch_start: new Date().toISOString().slice(0, 10),
                  dispatch_end: '',
                  dispatch_members: [],
                  note: '',
                  work_history: [],
                  created_at: Date.now(),
                })
              }
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-sm cursor-pointer"
            >
              ＋ 新規工番・現場登録
            </button>

            <button
              type="button"
              onClick={() => handlePullFromCloud()}
              disabled={syncing}
              className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold shadow-sm disabled:opacity-50 cursor-pointer"
            >
              {syncing ? '⏳ 読込中...' : '☁️ クラウド読込'}
            </button>

            <button
              type="button"
              onClick={() => {
                setDraftSettings(settings);
                setShowSettingsModal(true);
              }}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold cursor-pointer"
            >
              ⚙️ 連携設定
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 pt-5 space-y-4">
        {/* 通知バナー */}
        {banner && (
          <div
            className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-between gap-2 shadow-xs ${
              banner.type === 'ok'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-amber-50 text-amber-800 border border-amber-300'
            }`}
          >
            <span>{banner.text}</span>
            <button
              type="button"
              onClick={() => setBanner(null)}
              className="text-xs opacity-60 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        )}

        {/* フィルタタブ ＆ 検索バー */}
        <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                activeTab === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              すべて ({sites.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('unorganized')}
              className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1 cursor-pointer ${
                activeTab === 'unorganized'
                  ? 'bg-amber-600 text-white'
                  : 'bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100'
              }`}
            >
              <span>🆕 未整理・他アプリ作成</span>
              {unorganizedCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-amber-600 text-white text-[10px]">
                  {unorganizedCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('active')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                activeTab === 'active'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              📅 稼働中・予定
            </button>
          </div>

          <div className="flex items-center gap-2 flex-1 min-w-[220px] max-w-md">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="🔍 工番・現場名・元請け・顧客・出向者で検索..."
              className="w-full px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 text-xs"
            />
            <button
              type="button"
              onClick={handleExportJson}
              className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-300 text-[11px] font-bold text-slate-700 shrink-0 cursor-pointer"
              title="全工番データをJSON保存"
            >
              📥 JSON
            </button>
            <label
              className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-300 text-[11px] font-bold text-slate-700 shrink-0 cursor-pointer"
              title="JSONバックアップから復元"
            >
              📤 復元
              <input type="file" accept=".json" onChange={handleImportJson} className="hidden" />
            </label>
          </div>
        </div>

        {/* 工番・現場カード一覧 */}
        {filteredSites.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-10 text-center space-y-2">
            <div className="text-sm font-bold text-slate-600">該当する工番・現場がありません</div>
            <p className="text-xs text-slate-400">
              「＋ 新規工番・現場登録」から追加するか、「☁️ クラウド読込」で他アプリで作った現場を取り込んでください。
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredSites.map((site) => {
              const isUnorg =
                !site.kouban_no.trim() &&
                !site.prime_contractor.trim() &&
                !site.client_name.trim();
              return (
                <div
                  key={site.site_key}
                  className={`bg-white rounded-2xl border p-4 shadow-xs flex flex-col justify-between space-y-3 ${
                    isUnorg ? 'border-amber-300 bg-amber-50/20' : 'border-slate-200'
                  }`}
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {site.kouban_no ? (
                            <span className="px-2 py-0.5 rounded bg-blue-600 text-white font-mono text-[11px] font-bold">
                              工番: {site.kouban_no}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 text-[10px] font-bold">
                              🆕 工番未設定
                            </span>
                          )}
                          <span className="text-[11px] font-mono text-slate-400 truncate">
                            ID: {site.site_key}
                          </span>
                        </div>
                        <h2 className="text-base font-extrabold text-slate-900 truncate">
                          {site.site_name}
                        </h2>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => setEditingSite({ ...site })}
                          className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer"
                        >
                          ✏️ 情報を整理
                        </button>
                        {confirmDeleteKey === site.site_key ? (
                          <button
                            type="button"
                            onClick={() => handleDeleteSite(site.site_key)}
                            className="px-2 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-bold cursor-pointer"
                          >
                            削除確定
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteKey(site.site_key)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 text-xs cursor-pointer"
                            title="削除"
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    </div>

                    {/* 元請け・顧客・期間 */}
                    <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                      <div>
                        <span className="text-[10px] text-slate-400 block">元請け会社</span>
                        <span className="font-bold text-slate-800">
                          {site.prime_contractor || '（未入力）'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block">顧客・発注者</span>
                        <span className="font-bold text-slate-800">
                          {site.client_name || '（未入力）'}
                        </span>
                      </div>
                      <div className="col-span-2 pt-1 border-t border-slate-200/70 flex items-center justify-between">
                        <span className="text-[10px] text-slate-500">
                          📅 出向・工期:{' '}
                          <strong className="text-slate-700">
                            {site.dispatch_start || '未定'} ～ {site.dispatch_end || '未定'}
                          </strong>
                        </span>
                        <span className="text-[10px] text-slate-500">
                          📋 履歴: <strong>{site.work_history.length}件</strong>
                        </span>
                      </div>
                    </div>

                    {/* 出向者バッジ */}
                    {site.dispatch_members.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-[10px] font-bold text-slate-400 mr-1">👷 出向者:</span>
                        {site.dispatch_members.map((m, i) => (
                          <span
                            key={i}
                            className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-bold"
                          >
                            {m}
                          </span>
                        ))}
                      </div>
                    )}

                    {site.note && (
                      <p className="text-xs text-slate-600 bg-slate-50/70 px-2.5 py-1.5 rounded-lg border border-slate-100 line-clamp-2">
                        {site.note}
                      </p>
                    )}
                  </div>

                  {/* 各現場アプリへのクイック連携ボタン */}
                  <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                    <button
                      type="button"
                      onClick={() => openRelatedApp(settings.mamezuAppUrl, site, '豆図スタジオ')}
                      className="px-2 py-1 rounded bg-cyan-50 hover:bg-cyan-100 text-cyan-800 border border-cyan-200 cursor-pointer"
                    >
                      📐 豆図
                    </button>
                    <button
                      type="button"
                      onClick={() => openRelatedApp(settings.healthAppUrl, site, '健康確認メモ')}
                      className="px-2 py-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 cursor-pointer"
                    >
                      💚 健康確認
                    </button>
                    <button
                      type="button"
                      onClick={() => openRelatedApp(settings.fieldnoteAppUrl, site, '測量野帳')}
                      className="px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 cursor-pointer"
                    >
                      📓 野帳
                    </button>
                    <button
                      type="button"
                      onClick={() => openRelatedApp(settings.ledgerAppUrl, site, '工事写真台帳')}
                      className="px-2 py-1 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 cursor-pointer"
                    >
                      📷 写真台帳
                    </button>
                    <button
                      type="button"
                      onClick={() => openRelatedApp(settings.memoAppUrl, site, 'LogMemo')}
                      className="px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 cursor-pointer"
                    >
                      📝 メモ
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* 工番・現場 編集・詳細整理モーダル */}
      {editingSite && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <h3 className="font-bold text-sm">✏️ 工番・現場情報の登録・整理</h3>
              <button
                type="button"
                onClick={() => setEditingSite(null)}
                className="text-slate-300 hover:text-white px-2"
              >
                ✕
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">工番（工事番号）</label>
                  <input
                    type="text"
                    value={editingSite.kouban_no}
                    onChange={(e) =>
                      setEditingSite({ ...editingSite, kouban_no: e.target.value })
                    }
                    placeholder="例: 2026-A015"
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 font-mono font-bold text-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">システム現場キー（ID）</label>
                  <input
                    type="text"
                    value={editingSite.site_key}
                    onChange={(e) =>
                      setEditingSite({ ...editingSite, site_key: e.target.value })
                    }
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 font-mono text-slate-700 bg-slate-50"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">工事名・現場名 *</label>
                <input
                  type="text"
                  value={editingSite.site_name}
                  onChange={(e) =>
                    setEditingSite({ ...editingSite, site_name: e.target.value })
                  }
                  placeholder="例: ○○工場 2号焼却炉補修工事"
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 font-bold text-slate-900"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">元請け会社名</label>
                  <input
                    type="text"
                    value={editingSite.prime_contractor}
                    onChange={(e) =>
                      setEditingSite({ ...editingSite, prime_contractor: e.target.value })
                    }
                    placeholder="例: △△建設株式会社"
                    className="w-full border border-slate-300 rounded-xl px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">顧客・発注者名</label>
                  <input
                    type="text"
                    value={editingSite.client_name}
                    onChange={(e) =>
                      setEditingSite({ ...editingSite, client_name: e.target.value })
                    }
                    placeholder="例: □□環境サービス"
                    className="w-full border border-slate-300 rounded-xl px-3 py-2"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">出向・工期（開始日）</label>
                  <input
                    type="date"
                    value={editingSite.dispatch_start}
                    onChange={(e) =>
                      setEditingSite({ ...editingSite, dispatch_start: e.target.value })
                    }
                    className="w-full border border-slate-300 rounded-xl px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">出向・工期（終了予定日）</label>
                  <input
                    type="date"
                    value={editingSite.dispatch_end}
                    onChange={(e) =>
                      setEditingSite({ ...editingSite, dispatch_end: e.target.value })
                    }
                    className="w-full border border-slate-300 rounded-xl px-3 py-2"
                  />
                </div>
              </div>

              {/* 出向メンバー管理 */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <label className="block font-bold text-slate-700">👷 出向者・担当メンバー</label>
                <div className="flex flex-wrap gap-1.5">
                  {editingSite.dispatch_members.map((m, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-900 font-bold"
                    >
                      <span>{m}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setEditingSite({
                            ...editingSite,
                            dispatch_members: editingSite.dispatch_members.filter((_, idx) => idx !== i),
                          })
                        }
                        className="text-emerald-700 hover:text-rose-600 ml-0.5"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newMemberText}
                    onChange={(e) => setNewMemberText(e.target.value)}
                    placeholder="担当者名を入力..."
                    className="flex-1 border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!newMemberText.trim()) return;
                      setEditingSite({
                        ...editingSite,
                        dispatch_members: [...editingSite.dispatch_members, newMemberText.trim()],
                      });
                      setNewMemberText('');
                    }}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold"
                  >
                    ＋ 追加
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">備考・現場特記事項</label>
                <textarea
                  rows={2}
                  value={editingSite.note}
                  onChange={(e) => setEditingSite({ ...editingSite, note: e.target.value })}
                  placeholder="搬入経路・安全注意事項・連絡先メモなど"
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 resize-none"
                />
              </div>

              {/* 業務・作業履歴ログ */}
              <div className="p-3 rounded-xl bg-blue-50/50 border border-blue-200 space-y-2.5">
                <div className="font-bold text-slate-800">📋 業務・施工履歴ログ</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    type="date"
                    value={newHistoryDate}
                    onChange={(e) => setNewHistoryDate(e.target.value)}
                    className="border border-slate-300 rounded-lg px-2 py-1.5 bg-white"
                  />
                  <input
                    type="text"
                    value={newHistoryTitle}
                    onChange={(e) => setNewHistoryTitle(e.target.value)}
                    placeholder="作業内容（例: 足場組立・搬入）"
                    className="border border-slate-300 rounded-lg px-2 py-1.5 bg-white"
                  />
                  <input
                    type="text"
                    value={newHistoryMembers}
                    onChange={(e) => setNewHistoryMembers(e.target.value)}
                    placeholder="参加メンバー"
                    className="border border-slate-300 rounded-lg px-2 py-1.5 bg-white"
                  />
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newHistoryNote}
                    onChange={(e) => setNewHistoryNote(e.target.value)}
                    placeholder="詳細メモ・結果"
                    className="flex-1 border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!newHistoryTitle.trim()) return;
                      const entry: WorkHistoryEntry = {
                        id: `hist_${Date.now()}`,
                        date: newHistoryDate,
                        title: newHistoryTitle.trim(),
                        members: newHistoryMembers.trim(),
                        note: newHistoryNote.trim(),
                      };
                      setEditingSite({
                        ...editingSite,
                        work_history: [entry, ...editingSite.work_history],
                      });
                      setNewHistoryTitle('');
                      setNewHistoryMembers('');
                      setNewHistoryNote('');
                    }}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-bold shrink-0"
                  >
                    ＋ 履歴追加
                  </button>
                </div>

                {editingSite.work_history.length > 0 && (
                  <ul className="divide-y divide-slate-200 bg-white rounded-lg border border-slate-200 max-h-40 overflow-y-auto">
                    {editingSite.work_history.map((h) => (
                      <li key={h.id} className="p-2 flex items-start justify-between gap-2">
                        <div>
                          <div className="font-bold text-slate-800">
                            {h.date} ｜ {h.title}{' '}
                            {h.members && (
                              <span className="text-[11px] font-normal text-slate-500">
                                ({h.members})
                              </span>
                            )}
                          </div>
                          {h.note && <div className="text-[11px] text-slate-600">{h.note}</div>}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setEditingSite({
                              ...editingSite,
                              work_history: editingSite.work_history.filter((x) => x.id !== h.id),
                            })
                          }
                          className="text-slate-400 hover:text-rose-600 text-xs"
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setEditingSite(null)}
                className="px-4 py-2 rounded-xl bg-white border border-slate-300 text-xs font-bold text-slate-700"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleSaveEditingSite}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm"
              >
                💾 保存して反映
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 連携設定モーダル */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <h3 className="font-bold text-sm">⚙️ 共通サーバー ＆ 各現場アプリURL設定</h3>
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="text-slate-300 hover:text-white px-2"
              >
                ✕
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  ☁️ 共通同期サーバーURL（Cloudflare Workers `genba-sync`）
                </label>
                <input
                  type="url"
                  value={draftSettings.syncUrl}
                  onChange={(e) => setDraftSettings({ ...draftSettings, syncUrl: e.target.value })}
                  placeholder="https://genba-sync.thanksadd.workers.dev"
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 font-mono"
                />
              </div>

              <div className="pt-2 border-t border-slate-200 space-y-2.5">
                <div className="font-bold text-slate-600">
                  🔗 ワンタップ連携する各アプリの公開URL（任意）
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-0.5">📐 豆図スタジオ URL</label>
                  <input
                    type="url"
                    value={draftSettings.mamezuAppUrl}
                    onChange={(e) =>
                      setDraftSettings({ ...draftSettings, mamezuAppUrl: e.target.value })
                    }
                    placeholder="https://..."
                    className="w-full border border-slate-300 rounded-xl px-3 py-1.5 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-0.5">💚 健康確認メモ URL</label>
                  <input
                    type="url"
                    value={draftSettings.healthAppUrl}
                    onChange={(e) =>
                      setDraftSettings({ ...draftSettings, healthAppUrl: e.target.value })
                    }
                    placeholder="https://..."
                    className="w-full border border-slate-300 rounded-xl px-3 py-1.5 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-0.5">📓 測量野帳 URL</label>
                  <input
                    type="url"
                    value={draftSettings.fieldnoteAppUrl}
                    onChange={(e) =>
                      setDraftSettings({ ...draftSettings, fieldnoteAppUrl: e.target.value })
                    }
                    placeholder="https://..."
                    className="w-full border border-slate-300 rounded-xl px-3 py-1.5 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-0.5">📷 工事写真台帳 URL</label>
                  <input
                    type="url"
                    value={draftSettings.ledgerAppUrl}
                    onChange={(e) =>
                      setDraftSettings({ ...draftSettings, ledgerAppUrl: e.target.value })
                    }
                    placeholder="https://..."
                    className="w-full border border-slate-300 rounded-xl px-3 py-1.5 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-0.5">📝 LogMemo URL</label>
                  <input
                    type="url"
                    value={draftSettings.memoAppUrl}
                    onChange={(e) =>
                      setDraftSettings({ ...draftSettings, memoAppUrl: e.target.value })
                    }
                    placeholder="https://..."
                    className="w-full border border-slate-300 rounded-xl px-3 py-1.5 font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="px-4 py-2 rounded-xl bg-white border border-slate-300 text-xs font-bold text-slate-700"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => {
                  persistSettings(draftSettings);
                  setShowSettingsModal(false);
                  if (draftSettings.syncUrl.trim()) {
                    handlePullFromCloud(draftSettings.syncUrl);
                  }
                }}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm"
              >
                💾 設定を保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}