"use client";
import { useActionState, useState } from "react";
import { assetMetaAction, signedUrlAction, uploadAssetAction } from "@/app/actions/content";
import { Input, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { FormMessage } from "@/components/ui/form-message";

export function AssetMetaForm({ assetId, title, tags, category }: { assetId: string; title: string; tags: string; category: string }) {
  const [state, action] = useActionState(assetMetaAction, null);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="assetId" value={assetId} />
      <Input name="title" label="Title" defaultValue={title} required />
      <div className="grid grid-cols-2 gap-3">
        <Input name="tags" label="Tags" defaultValue={tags} />
        <Input name="category" label="Category" defaultValue={category} />
      </div>
      <div className="flex justify-end"><SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">Save details</SubmitButton></div>
      <p className="text-[11px] text-ink-400">Editing details does not change the file, so it does not affect approval.</p>
    </form>
  );
}

export function DownloadButton({ versionId }: { versionId: string }) {
  const [err, setErr] = useState<string | null>(null);
  return (
    <span>
      <Button size="sm" variant="ghost" onClick={async () => { const r = await signedUrlAction(versionId, true); if (r.ok && r.data) window.location.href = r.data; else if (!r.ok) setErr(r.error); }}>Download</Button>
      {err && <span role="alert" className="ml-2 text-[11px] text-red-300">{err}</span>}
    </span>
  );
}

export function LibraryUpload({ workspaceId, categories }: { workspaceId: string; categories: string[] }) {
  const [state, action] = useActionState(uploadAssetAction, null);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2" encType="multipart/form-data">
      <div className="sm:col-span-2"><FormMessage state={state} /></div>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <Input name="title" label="Title" required />
      <Select name="kind" label="Type"><option value="VIDEO">Video</option><option value="IMAGE">Image</option><option value="THUMBNAIL">Thumbnail</option></Select>
      <Input name="tags" label="Tags" hint="(comma separated)" />
      <Select name="category" label="Category"><option value="">—</option>{categories.map((c) => <option key={c}>{c}</option>)}</Select>
      <Input name="file" type="file" label="File" accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp" required className="sm:col-span-2" />
      <p className="text-xs text-ink-400 sm:col-span-2">Library uploads are not linked to a calendar concept. To submit a day’s video for approval, upload it from that concept in the Studio.</p>
      <div className="flex justify-end sm:col-span-2"><SubmitButton pendingLabel="Uploading…">Upload</SubmitButton></div>
    </form>
  );
}
