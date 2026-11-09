"use client";

import { useState } from "react";
import { KEY_TEST_CLIENT_ABORT_MS } from "@/lib/limits";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apiKey: string;
  onApiKey: (value: string) => void;
  remember: boolean;
  onRemember: (value: boolean) => void;
  saveHistory: boolean;
  onSaveHistory: (value: boolean) => void;
  syncIntervalHours: number;
  onSyncInterval: (hours: number) => Promise<void>;
  owner: string;
  testModelId: string | null;
  onClearHistory: () => Promise<void>;
};

export function SettingsDialog({
  open,
  onOpenChange,
  apiKey,
  onApiKey,
  remember,
  onRemember,
  saveHistory,
  onSaveHistory,
  syncIntervalHours,
  onSyncInterval,
  owner,
  testModelId,
  onClearHistory,
}: Props) {
  const [hours, setHours] = useState(String(syncIntervalHours));
  const [seenHours, setSeenHours] = useState(syncIntervalHours);
  if (seenHours !== syncIntervalHours) {
    setSeenHours(syncIntervalHours);
    setHours(String(syncIntervalHours));
  }
  const [notice, setNotice] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  async function testKey() {
    setTesting(true);
    setNotice("");
    try {
      const response = await fetch("/api/key/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-nvidia-api-key": apiKey,
        },
        body: JSON.stringify(testModelId ? { modelId: testModelId } : {}),
        signal: AbortSignal.timeout(KEY_TEST_CLIENT_ABORT_MS),
      });
      const data = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!data?.message) {
        setNotice(
          response.status === 504
            ? "测试超时，服务器没有返回结果。这不能说明 Key 无效。"
            : response.ok
              ? "连接可用。"
              : "测试没有完成。",
        );
        return;
      }
      setNotice(data.message);
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "TimeoutError";
      setNotice(timedOut ? "测试超时。这不能说明 Key 无效，可以再测一次。" : "网络失败。输入还在，可以再测一次。");
    } finally {
      setTesting(false);
    }
  }

  async function saveHours() {
    const value = Number(hours);
    setSaving(true);
    setNotice("");
    try {
      await onSyncInterval(value);
      setNotice("同步间隔已保存。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "没有保存。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>
            API Key 只在发往 NVIDIA 时使用，不写入数据库，也不出现在地址栏。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="api-key">NVIDIA API Key</Label>
            <Input
              id="api-key"
              type="password"
              autoComplete="off"
              placeholder="nvapi-..."
              value={apiKey}
              onChange={(event) => onApiKey(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => onApiKey("")}>
                清除
              </Button>
              <Button type="button" size="sm" disabled={!apiKey || testing} onClick={testKey}>
                {testing ? "测试中" : "测试连接"}
              </Button>
              <a
                className="inline-flex h-7 items-center px-2 text-sm text-primary underline-offset-4 hover:underline"
                href="https://build.nvidia.com/settings"
                target="_blank"
                rel="noreferrer"
              >
                去 NVIDIA 获取 Key
              </a>
            </div>
          </div>
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>在这台浏览器记住 Key</span>
            <Switch checked={remember} onCheckedChange={onRemember} />
          </label>
          <p className="text-xs leading-5 text-muted-foreground">
            默认只留在本次标签页。勾选后保存在这台浏览器的本地存储，仍然不会上传到目录数据库。
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            选中可聊天模型时，测试发往该模型。未选择时，改用目录里较小的可聊天模型。最长约 50 秒；超时会返回明确错误，不能说明 Key 无效。
          </p>
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>保存聊天记录</span>
            <Switch checked={saveHistory} onCheckedChange={onSaveHistory} />
          </label>
          <p className="text-xs leading-5 text-muted-foreground">
            关闭后新消息只留在当前页面。已有记录可以删除。记录按这台浏览器的身份标记分开存放。
          </p>
          <div className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="sync-hours">同步间隔（小时）</Label>
              <Input
                id="sync-hours"
                inputMode="numeric"
                value={hours}
                onChange={(event) => setHours(event.target.value)}
              />
            </div>
            <Button type="button" variant="outline" disabled={saving} onClick={saveHours}>
              保存间隔
            </Button>
          </div>
          <Button
            type="button"
            variant="destructive"
            onClick={async () => {
              await onClearHistory();
              setNotice("已删除这台浏览器保存的会话。");
            }}
          >
            删除已保存的会话
          </Button>
          {notice ? <p className="text-sm leading-6">{notice}</p> : null}
          <p className="font-mono text-[11px] text-muted-foreground">身份标记 {owner.slice(0, 8)}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
