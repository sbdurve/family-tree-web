'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface Submission {
  id: number;
  type: string;
  person_name: string;
  person_full_name: string;
  parent_id: string;
  spouse_of: string;
  image_url: string;
  link_url: string;
  link_description: string;
  tooltip: string;
  submitter_name: string;
  submitter_email: string;
  notes: string;
  status: string;
  submitted_at: string;
}

interface Person {
  id: string;
  full_name: string;
  alt_name: string;
  parent_id: string | null;
  tooltip: string;
  image_url: string;
  status: string;
}

interface Spouse {
  id: string;
  full_name: string;
  alt_name: string;
  person_id: string;
  image_url: string;
}

interface Link {
  id: number;
  person_id: string;
  url: string;
  description: string;
  display_html: string;
}

type Tab = 'submissions' | 'people' | 'links';

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

export default function AdminPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('submissions');
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [spouses, setSpouses] = useState<Spouse[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchPeople, setSearchPeople] = useState('');
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // Person edit
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [editForm, setEditForm] = useState<Partial<Person>>({});
  const [savingEdit, setSavingEdit] = useState(false);

  // Spouse edit
  const [editingSpouse, setEditingSpouse] = useState<Spouse | null>(null);
  const [editSpouseForm, setEditSpouseForm] = useState<Partial<Spouse>>({});
  const [savingSpouseEdit, setSavingSpouseEdit] = useState(false);

  // Add person form
  const [newPerson, setNewPerson] = useState({ id: '', full_name: '', alt_name: '', parent_id: '', tooltip: '', image_url: '' });
  const [addingPerson, setAddingPerson] = useState(false);

  // Add spouse form
  const [newSpouse, setNewSpouse] = useState({ id: '', full_name: '', alt_name: '', person_id: '', image_url: '' });
  const [addingSpouse, setAddingSpouse] = useState(false);

  // Add link form
  const [newLink, setNewLink] = useState({ person_id: '', url: '', description: '', display_html: '' });
  const [addingLink, setAddingLink] = useState(false);

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [subRes, pplRes, spouseRes, lnkRes] = await Promise.all([
        fetch('/api/admin/submissions'),
        fetch('/api/admin/people'),
        fetch('/api/admin/spouses'),
        fetch('/api/admin/links'),
      ]);
      if (subRes.status === 401 || pplRes.status === 401) {
        router.push('/admin/login');
        return;
      }
      const [subData, pplData, spouseData, lnkData] = await Promise.all([
        subRes.json() as Promise<{ submissions: Submission[] }>,
        pplRes.json() as Promise<{ people: Person[] }>,
        spouseRes.json() as Promise<{ spouses: Spouse[] }>,
        lnkRes.json() as Promise<{ links: Link[] }>,
      ]);
      setSubmissions(subData.submissions ?? []);
      setPeople(pplData.people ?? []);
      setSpouses(spouseData.spouses ?? []);
      setLinks(lnkData.links ?? []);
    } catch {
      showToast('Failed to load data', false);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Submission actions ────────────────────────────────────────────────────

  async function handleSubmissionAction(id: number, action: 'approve' | 'reject') {
    setActionLoading(id);
    try {
      const res = await fetch('/api/admin/submissions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      if (res.ok) {
        showToast(`Submission ${action}d successfully`, true);
        await fetchAll();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast((err as { error?: string }).error ?? `Failed to ${action}`, false);
      }
    } catch { showToast('Network error', false); }
    finally { setActionLoading(null); }
  }

  // ── Person actions ────────────────────────────────────────────────────────

  async function handleAddPerson(e: React.FormEvent) {
    e.preventDefault();
    setAddingPerson(true);
    try {
      const res = await fetch('/api/admin/people', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPerson),
      });
      if (res.ok) {
        showToast('Person added', true);
        setNewPerson({ id: '', full_name: '', alt_name: '', parent_id: '', tooltip: '', image_url: '' });
        await fetchAll();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast((err as { error?: string }).error ?? 'Failed to add person', false);
      }
    } catch { showToast('Network error', false); }
    finally { setAddingPerson(false); }
  }

  async function handleSavePerson() {
    if (!editingPerson) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/admin/people/${editingPerson.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      if (res.ok) { showToast('Person updated', true); setEditingPerson(null); await fetchAll(); }
      else showToast('Failed to update', false);
    } catch { showToast('Network error', false); }
    finally { setSavingEdit(false); }
  }

  async function handleDeletePerson(id: string) {
    if (!confirm(`Delete person "${id}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/admin/people/${id}`, { method: 'DELETE' });
      if (res.ok) { showToast('Person deleted', true); await fetchAll(); }
      else showToast('Failed to delete', false);
    } catch { showToast('Network error', false); }
  }

  // ── Spouse actions ────────────────────────────────────────────────────────

  async function handleAddSpouse(e: React.FormEvent) {
    e.preventDefault();
    setAddingSpouse(true);
    try {
      const res = await fetch('/api/admin/spouses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSpouse),
      });
      if (res.ok) {
        showToast('Spouse added', true);
        setNewSpouse({ id: '', full_name: '', alt_name: '', person_id: '', image_url: '' });
        await fetchAll();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast((err as { error?: string }).error ?? 'Failed to add spouse', false);
      }
    } catch { showToast('Network error', false); }
    finally { setAddingSpouse(false); }
  }

  async function handleSaveSpouse() {
    if (!editingSpouse) return;
    setSavingSpouseEdit(true);
    try {
      const res = await fetch('/api/admin/spouses', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingSpouse.id, ...editSpouseForm }),
      });
      if (res.ok) { showToast('Spouse updated', true); setEditingSpouse(null); await fetchAll(); }
      else showToast('Failed to update', false);
    } catch { showToast('Network error', false); }
    finally { setSavingSpouseEdit(false); }
  }

  async function handleDeleteSpouse(id: string) {
    if (!confirm(`Delete spouse "${id}"?`)) return;
    try {
      const res = await fetch(`/api/admin/spouses?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (res.ok) { showToast('Spouse deleted', true); await fetchAll(); }
      else showToast('Failed to delete', false);
    } catch { showToast('Network error', false); }
  }

  // ── Link actions ──────────────────────────────────────────────────────────

  async function handleAddLink(e: React.FormEvent) {
    e.preventDefault();
    setAddingLink(true);
    try {
      const res = await fetch('/api/admin/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newLink),
      });
      if (res.ok) {
        showToast('Link added', true);
        setNewLink({ person_id: '', url: '', description: '', display_html: '' });
        await fetchAll();
      } else showToast('Failed to add link', false);
    } catch { showToast('Network error', false); }
    finally { setAddingLink(false); }
  }

  async function handleDeleteLink(id: number) {
    if (!confirm('Delete this link?')) return;
    try {
      const res = await fetch(`/api/admin/links?id=${id}`, { method: 'DELETE' });
      if (res.ok) { showToast('Link deleted', true); await fetchAll(); }
      else showToast('Failed to delete link', false);
    } catch { showToast('Network error', false); }
  }

  // ── Derived data ──────────────────────────────────────────────────────────

  const term = searchPeople.toLowerCase();
  const filteredPeople = people.filter(
    (p) => p.id.toLowerCase().includes(term) || p.full_name.toLowerCase().includes(term) || (p.alt_name ?? '').toLowerCase().includes(term)
  );
  const filteredSpouses = spouses.filter(
    (s) => s.id.toLowerCase().includes(term) || s.full_name.toLowerCase().includes(term) || (s.alt_name ?? '').toLowerCase().includes(term) || s.person_id.toLowerCase().includes(term)
  );

  const pendingSubmissions = submissions.filter((s) => s.status === 'pending');
  const totalPeople = people.length + spouses.length;

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'submissions', label: 'Submissions', count: pendingSubmissions.length },
    { key: 'people', label: 'People', count: totalPeople },
    { key: 'links', label: 'Links', count: links.length },
  ];

  const inputCls = 'w-full border border-tan-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400';

  return (
    <div className="max-w-6xl mx-auto">
      {/* Toast */}
      {toast && (
        <div className={cn('fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium', toast.ok ? 'bg-green-600' : 'bg-red-600')}>
          {toast.msg}
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-tan-800">Admin Dashboard</h1>
          <div className="flex items-center gap-4">
              <a
              href="https://github.com/sbdurve/family-tree-web/actions/runs/39613156653"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
              Backup D1 to Excel
              </a>
            <button
              onClick={() => fetch('/api/admin/login', { method: 'DELETE' }).finally(() => router.push('/admin/login'))}
              className="text-sm text-tan-600 hover:text-tan-800 underline"
            >
              Sign out
            </button>
       </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-tan-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={cn(
              'px-4 py-2 text-sm font-medium rounded-t-lg transition-colors border-b-2 -mb-px',
              activeTab === t.key ? 'border-tan-700 text-tan-800 bg-tan-50' : 'border-transparent text-tan-500 hover:text-tan-700'
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={cn('ml-2 text-xs px-1.5 py-0.5 rounded-full', activeTab === t.key ? 'bg-tan-200 text-tan-800' : 'bg-tan-100 text-tan-600')}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-tan-300 border-t-tan-700" />
        </div>
      ) : (
        <>
          {/* ── SUBMISSIONS TAB ─────────────────────────────────────────── */}
          {activeTab === 'submissions' && (
            <div>
              <h2 className="text-xl font-semibold text-tan-700 mb-4">Pending Submissions ({pendingSubmissions.length})</h2>
              {pendingSubmissions.length === 0 ? (
                <div className="text-center py-16 text-tan-500"><span className="text-4xl block mb-3">✅</span>No pending submissions</div>
              ) : (
                <div className="space-y-4">
                  {pendingSubmissions.map((sub) => (
                    <div key={sub.id} className="bg-white border border-tan-200 rounded-xl p-5 shadow-sm">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs font-semibold uppercase tracking-wide bg-tan-100 text-tan-700 px-2 py-0.5 rounded">{sub.type}</span>
                            <span className="text-xs text-tan-400">{sub.submitted_at}</span>
                          </div>
                          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                            {sub.person_name && <div><dt className="text-tan-500 inline">Short ID: </dt><dd className="inline font-medium">{sub.person_name}</dd></div>}
                            {sub.person_full_name && <div><dt className="text-tan-500 inline">Full name: </dt><dd className="inline font-medium">{sub.person_full_name}</dd></div>}
                            {sub.parent_id && <div><dt className="text-tan-500 inline">Parent: </dt><dd className="inline">{sub.parent_id}</dd></div>}
                            {sub.spouse_of && <div><dt className="text-tan-500 inline">Spouse of: </dt><dd className="inline">{sub.spouse_of}</dd></div>}
                            {sub.link_url && <div className="sm:col-span-2"><dt className="text-tan-500 inline">Link: </dt><dd className="inline break-all text-blue-600">{sub.link_url}</dd>{sub.link_description && <span className="text-tan-400"> — {sub.link_description}</span>}</div>}
                            {sub.notes && <div className="sm:col-span-2"><dt className="text-tan-500 inline">Notes: </dt><dd className="inline italic">{sub.notes}</dd></div>}
                            {sub.submitter_name && <div><dt className="text-tan-500 inline">From: </dt><dd className="inline">{sub.submitter_name} {sub.submitter_email ? `<${sub.submitter_email}>` : ''}</dd></div>}
                            {sub.image_url && <div className="sm:col-span-2 flex items-center gap-2"><dt className="text-tan-500">Image:</dt><img src={sub.image_url} alt="submission" className="h-12 w-12 rounded object-cover border border-tan-200" /></div>}
                          </dl>
                        </div>
                        <div className="flex flex-col gap-2 shrink-0">
                          <button onClick={() => handleSubmissionAction(sub.id, 'approve')} disabled={actionLoading === sub.id} className="px-4 py-1.5 bg-green-600 hover:bg-green-500 disabled:bg-green-200 text-white text-sm font-medium rounded-lg transition-colors">{actionLoading === sub.id ? '…' : 'Approve'}</button>
                          <button onClick={() => handleSubmissionAction(sub.id, 'reject')} disabled={actionLoading === sub.id} className="px-4 py-1.5 bg-red-600 hover:bg-red-500 disabled:bg-red-200 text-white text-sm font-medium rounded-lg transition-colors">{actionLoading === sub.id ? '…' : 'Reject'}</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {submissions.filter((s) => s.status !== 'pending').length > 0 && (
                <details className="mt-8">
                  <summary className="cursor-pointer text-sm text-tan-500 hover:text-tan-700">Show resolved submissions ({submissions.filter((s) => s.status !== 'pending').length})</summary>
                  <div className="mt-3 space-y-2">
                    {submissions.filter((s) => s.status !== 'pending').map((sub) => (
                      <div key={sub.id} className="bg-tan-50 border border-tan-200 rounded-lg p-3 text-sm text-tan-600">
                        <span className={cn('text-xs font-semibold uppercase mr-2 px-1.5 py-0.5 rounded', sub.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>{sub.status}</span>
                        [{sub.type}] {sub.person_full_name || sub.link_url || sub.notes} — {sub.submitted_at}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {/* ── PEOPLE TAB ──────────────────────────────────────────────── */}
          {activeTab === 'people' && (
            <div>
              <h2 className="text-xl font-semibold text-tan-700 mb-4">
                People ({people.length} members · {spouses.length} spouses)
              </h2>

              {/* Add person */}
              <details className="mb-3 bg-white border border-tan-200 rounded-xl p-4">
                <summary className="cursor-pointer font-medium text-tan-700 hover:text-tan-900">+ Add family member</summary>
                <form onSubmit={handleAddPerson} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {([
                    { key: 'id', label: 'Short ID (unique)', placeholder: 'e.g. john_doe', required: true },
                    { key: 'full_name', label: 'Full Name', placeholder: 'John Doe', required: true },
                    { key: 'alt_name', label: 'Alt Name (maiden / aka)', placeholder: 'e.g. Joshi' },
                    { key: 'parent_id', label: 'Parent ID', placeholder: 'Leave blank for root' },
                    { key: 'image_url', label: 'Image URL', placeholder: 'https://...' },
                  ] as { key: string; label: string; placeholder: string; required?: boolean }[]).map((f) => (
                    <div key={f.key}>
                      <label className="block text-xs font-medium text-tan-600 mb-1">{f.label}</label>
                      <input type="text" required={f.required} placeholder={f.placeholder} value={(newPerson as Record<string, string>)[f.key]} onChange={(e) => setNewPerson((p) => ({ ...p, [f.key]: e.target.value }))} className={inputCls} />
                    </div>
                  ))}
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-tan-600 mb-1">Notes / Tooltip</label>
                    <textarea rows={2} value={newPerson.tooltip} onChange={(e) => setNewPerson((p) => ({ ...p, tooltip: e.target.value }))} className={inputCls} />
                  </div>
                  <div className="sm:col-span-2">
                    <button type="submit" disabled={addingPerson} className="bg-accent-600 hover:bg-accent-500 disabled:bg-tan-300 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors">{addingPerson ? 'Adding…' : 'Add Member'}</button>
                  </div>
                </form>
              </details>

              {/* Add spouse */}
              <details className="mb-6 bg-white border border-tan-200 rounded-xl p-4">
                <summary className="cursor-pointer font-medium text-tan-700 hover:text-tan-900">+ Add spouse</summary>
                <form onSubmit={handleAddSpouse} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {([
                    { key: 'id', label: 'Spouse ID (unique)', placeholder: 'e.g. annu', required: true },
                    { key: 'full_name', label: 'Full Name', placeholder: 'Annu Durve', required: true },
                    { key: 'alt_name', label: 'Alt Name (maiden / aka)', placeholder: 'e.g. Kulkarni' },
                    { key: 'image_url', label: 'Image URL', placeholder: 'https://...' },
                  ] as { key: string; label: string; placeholder: string; required?: boolean }[]).map((f) => (
                    <div key={f.key}>
                      <label className="block text-xs font-medium text-tan-600 mb-1">{f.label}</label>
                      <input type="text" required={f.required} placeholder={f.placeholder} value={(newSpouse as Record<string, string>)[f.key]} onChange={(e) => setNewSpouse((p) => ({ ...p, [f.key]: e.target.value }))} className={inputCls} />
                    </div>
                  ))}
                  <div>
                    <label className="block text-xs font-medium text-tan-600 mb-1">Spouse of</label>
                    <select required value={newSpouse.person_id} onChange={(e) => setNewSpouse((p) => ({ ...p, person_id: e.target.value }))} className={inputCls}>
                      <option value="">Select person…</option>
                      {people.filter((p) => p.status === 'approved').map((p) => (
                        <option key={p.id} value={p.id}>{p.full_name}{p.alt_name ? ` (${p.alt_name})` : ''}</option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <button type="submit" disabled={addingSpouse} className="bg-accent-600 hover:bg-accent-500 disabled:bg-tan-300 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors">{addingSpouse ? 'Adding…' : 'Add Spouse'}</button>
                  </div>
                </form>
              </details>

              {/* Search */}
              <input type="search" placeholder="Search by name, alt name, or ID…" value={searchPeople} onChange={(e) => setSearchPeople(e.target.value)} className="w-full border border-tan-300 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-accent-400" />

              {/* Edit person modal */}
              {editingPerson && (
                <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4">
                  <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6">
                    <h3 className="text-lg font-bold text-tan-800 mb-4">Edit member: {editingPerson.full_name}</h3>
                    <div className="space-y-3">
                      {([
                        { key: 'full_name', label: 'Full Name' },
                        { key: 'alt_name', label: 'Alt Name (maiden / aka)' },
                        { key: 'parent_id', label: 'Parent ID' },
                        { key: 'image_url', label: 'Image URL' },
                      ] as { key: string; label: string }[]).map((f) => (
                        <div key={f.key}>
                          <label className="block text-xs font-medium text-tan-600 mb-1">{f.label}</label>
                          <input type="text" value={(editForm as Record<string, string | null>)[f.key] as string ?? ''} onChange={(e) => setEditForm((p) => ({ ...p, [f.key]: e.target.value }))} className={inputCls} />
                        </div>
                      ))}
                      <div>
                        <label className="block text-xs font-medium text-tan-600 mb-1">Notes / Tooltip</label>
                        <textarea rows={3} value={(editForm.tooltip as string) ?? ''} onChange={(e) => setEditForm((p) => ({ ...p, tooltip: e.target.value }))} className={inputCls} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-tan-600 mb-1">Status</label>
                        <select value={(editForm.status as string) ?? 'approved'} onChange={(e) => setEditForm((p) => ({ ...p, status: e.target.value }))} className={inputCls}>
                          <option value="approved">approved</option>
                          <option value="hidden">hidden</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-3 mt-5">
                      <button onClick={handleSavePerson} disabled={savingEdit} className="bg-accent-600 hover:bg-accent-500 disabled:bg-tan-300 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors">{savingEdit ? 'Saving…' : 'Save'}</button>
                      <button onClick={() => setEditingPerson(null)} className="border border-tan-300 text-tan-700 px-5 py-2 rounded-lg text-sm font-medium hover:bg-tan-50 transition-colors">Cancel</button>
                    </div>
                  </div>
                </div>
              )}

              {/* Edit spouse modal */}
              {editingSpouse && (
                <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4">
                  <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6">
                    <h3 className="text-lg font-bold text-tan-800 mb-4">Edit spouse: {editingSpouse.full_name}</h3>
                    <div className="space-y-3">
                      {([
                        { key: 'full_name', label: 'Full Name' },
                        { key: 'alt_name', label: 'Alt Name (maiden / aka)' },
                        { key: 'image_url', label: 'Image URL' },
                      ] as { key: string; label: string }[]).map((f) => (
                        <div key={f.key}>
                          <label className="block text-xs font-medium text-tan-600 mb-1">{f.label}</label>
                          <input type="text" value={(editSpouseForm as Record<string, string>)[f.key] ?? ''} onChange={(e) => setEditSpouseForm((p) => ({ ...p, [f.key]: e.target.value }))} className={inputCls} />
                        </div>
                      ))}
                      <div>
                        <label className="block text-xs font-medium text-tan-600 mb-1">Spouse of</label>
                        <select value={(editSpouseForm.person_id as string) ?? ''} onChange={(e) => setEditSpouseForm((p) => ({ ...p, person_id: e.target.value }))} className={inputCls}>
                          {people.filter((p) => p.status === 'approved').map((p) => (
                            <option key={p.id} value={p.id}>{p.full_name}{p.alt_name ? ` (${p.alt_name})` : ''}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-3 mt-5">
                      <button onClick={handleSaveSpouse} disabled={savingSpouseEdit} className="bg-accent-600 hover:bg-accent-500 disabled:bg-tan-300 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors">{savingSpouseEdit ? 'Saving…' : 'Save'}</button>
                      <button onClick={() => setEditingSpouse(null)} className="border border-tan-300 text-tan-700 px-5 py-2 rounded-lg text-sm font-medium hover:bg-tan-50 transition-colors">Cancel</button>
                    </div>
                  </div>
                </div>
              )}

              {/* Combined table */}
              <div className="overflow-x-auto rounded-xl border border-tan-200">
                <table className="w-full text-sm">
                  <thead className="bg-tan-100 text-tan-700">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold">Name</th>
                      <th className="px-4 py-2 text-left font-semibold">Alt Name</th>
                      <th className="px-4 py-2 text-left font-semibold">Role</th>
                      <th className="px-4 py-2 text-left font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-tan-100">
                    {/* Family members */}
                    {filteredPeople.map((p) => (
                      <tr key={`p-${p.id}`} className="hover:bg-tan-50 transition-colors">
                        <td className="px-4 py-2">
                          <div className="font-medium">{p.full_name}</div>
                          <div className="text-xs text-tan-400 font-mono">{p.id}</div>
                        </td>
                        <td className="px-4 py-2 text-tan-500 italic">{p.alt_name || '—'}</td>
                        <td className="px-4 py-2">
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-accent-50 text-accent-700">
                            {p.parent_id ? `child of ${p.parent_id}` : 'root'}
                          </span>
                          {p.status !== 'approved' && (
                            <span className="ml-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{p.status}</span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex gap-2">
                            <button onClick={() => { setEditingPerson(p); setEditForm({ full_name: p.full_name, alt_name: p.alt_name ?? '', parent_id: p.parent_id ?? '', tooltip: p.tooltip, image_url: p.image_url, status: p.status }); }} className="text-xs text-blue-600 hover:underline">Edit</button>
                            <button onClick={() => handleDeletePerson(p.id)} className="text-xs text-red-600 hover:underline">Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {/* Spouses */}
                    {filteredSpouses.map((s) => {
                      const linked = people.find((p) => p.id === s.person_id);
                      return (
                        <tr key={`s-${s.id}`} className="hover:bg-pink-50 transition-colors bg-pink-50/30">
                          <td className="px-4 py-2">
                            <div className="font-medium">{s.full_name}</div>
                            <div className="text-xs text-tan-400 font-mono">{s.id}</div>
                          </td>
                          <td className="px-4 py-2 text-tan-500 italic">{s.alt_name || '—'}</td>
                          <td className="px-4 py-2">
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-pink-100 text-pink-700">
                              ♥ spouse of {linked ? linked.full_name : s.person_id}
                            </span>
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex gap-2">
                              <button onClick={() => { setEditingSpouse(s); setEditSpouseForm({ full_name: s.full_name, alt_name: s.alt_name ?? '', person_id: s.person_id, image_url: s.image_url }); }} className="text-xs text-blue-600 hover:underline">Edit</button>
                              <button onClick={() => handleDeleteSpouse(s.id)} className="text-xs text-red-600 hover:underline">Delete</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── LINKS TAB ───────────────────────────────────────────────── */}
          {activeTab === 'links' && (
            <div>
              <h2 className="text-xl font-semibold text-tan-700 mb-4">Links ({links.length})</h2>
              <details className="mb-6 bg-white border border-tan-200 rounded-xl p-4">
                <summary className="cursor-pointer font-medium text-tan-700 hover:text-tan-900">+ Add new link</summary>
                <form onSubmit={handleAddLink} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-tan-600 mb-1">Person</label>
                    <select required value={newLink.person_id} onChange={(e) => setNewLink((p) => ({ ...p, person_id: e.target.value }))} className={inputCls}>
                      <option value="">Select person…</option>
                      {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}{p.alt_name ? ` (${p.alt_name})` : ''}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-tan-600 mb-1">URL</label>
                    <input type="url" required value={newLink.url} onChange={(e) => setNewLink((p) => ({ ...p, url: e.target.value }))} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-tan-600 mb-1">Description</label>
                    <input type="text" value={newLink.description} onChange={(e) => setNewLink((p) => ({ ...p, description: e.target.value }))} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-tan-600 mb-1">Display HTML (optional)</label>
                    <input type="text" value={newLink.display_html} onChange={(e) => setNewLink((p) => ({ ...p, display_html: e.target.value }))} className={inputCls} />
                  </div>
                  <div className="sm:col-span-2">
                    <button type="submit" disabled={addingLink} className="bg-accent-600 hover:bg-accent-500 disabled:bg-tan-300 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors">{addingLink ? 'Adding…' : 'Add Link'}</button>
                  </div>
                </form>
              </details>
              <div className="overflow-x-auto rounded-xl border border-tan-200">
                <table className="w-full text-sm">
                  <thead className="bg-tan-100 text-tan-700">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold">Person</th>
                      <th className="px-4 py-2 text-left font-semibold">URL</th>
                      <th className="px-4 py-2 text-left font-semibold">Description</th>
                      <th className="px-4 py-2 text-left font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-tan-100">
                    {links.map((l) => {
                      const p = people.find((x) => x.id === l.person_id);
                      return (
                        <tr key={l.id} className="hover:bg-tan-50 transition-colors">
                          <td className="px-4 py-2 font-mono text-xs">{p ? p.full_name : l.person_id}</td>
                          <td className="px-4 py-2 max-w-xs truncate"><a href={l.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{l.url}</a></td>
                          <td className="px-4 py-2 text-tan-600">{l.description}</td>
                          <td className="px-4 py-2"><button onClick={() => handleDeleteLink(l.id)} className="text-xs text-red-600 hover:underline">Delete</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
