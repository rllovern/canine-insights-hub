import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { HOUR_DAYS, type Answers, type FieldDef } from "@/lib/onboarding/schema";

type Props = {
  field: FieldDef;
  value: unknown;
  scope: Answers;
  error?: string;
  prefillValue?: string;
  onChange: (v: unknown) => void;
};

function Hours({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const v = (value as Record<string, { closed?: boolean; open?: string; close?: string }>) ?? {};
  const set = (day: string, patch: Record<string, unknown>) => onChange({ ...v, [day]: { ...(v[day] ?? {}), ...patch } });
  return (
    <div className="space-y-2">
      {HOUR_DAYS.map((day) => {
        const row = v[day] ?? {};
        return (
          <div key={day} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
            <span className="w-24 text-sm font-medium">{day}</span>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox checked={!!row.closed} onCheckedChange={(c) => set(day, { closed: c === true })} />
              Closed
            </label>
            {!row.closed && (
              <>
                <Input type="time" className="w-32" value={row.open ?? ""} onChange={(e) => set(day, { open: e.target.value })} />
                <span className="text-muted-foreground">to</span>
                <Input type="time" className="w-32" value={row.close ?? ""} onChange={(e) => set(day, { close: e.target.value })} />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function GeoList({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const list = (value as string[]) ?? [];
  return (
    <div className="space-y-2">
      {list.map((item, i) => (
        <div key={i} className="flex gap-2">
          <Input
            value={item}
            placeholder="Ashtabula County, OH"
            onChange={(e) => {
              const next = [...list];
              next[i] = e.target.value;
              onChange(next);
            }}
          />
          <Button type="button" variant="ghost" size="icon" onClick={() => onChange(list.filter((_, j) => j !== i))}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...list, ""])}>
        <Plus className="mr-1 h-4 w-4" /> Add area
      </Button>
    </div>
  );
}

function RankList({ options, value, onChange }: { options: string[]; value: unknown; onChange: (v: unknown) => void }) {
  const order: string[] = Array.isArray(value) && (value as string[]).length === options.length ? (value as string[]) : options;
  const move = (i: number, dir: -1 | 1) => {
    const next = [...order];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <ol className="space-y-2">
      {order.map((opt, i) => (
        <li key={opt} className="flex items-center gap-2 rounded-md border border-border p-2">
          <span className="w-6 text-sm text-muted-foreground">{i + 1}</span>
          <span className="flex-1 text-sm">{opt}</span>
          <Button type="button" variant="ghost" size="icon" onClick={() => move(i, -1)} aria-label="Move up">
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" onClick={() => move(i, 1)} aria-label="Move down">
            <ArrowDown className="h-4 w-4" />
          </Button>
        </li>
      ))}
    </ol>
  );
}

function MultiSelect({ options, value, onChange }: { options: string[]; value: unknown; onChange: (v: unknown) => void }) {
  const list = (value as string[]) ?? [];
  const toggle = (opt: string) => onChange(list.includes(opt) ? list.filter((o) => o !== opt) : [...list, opt]);
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <label key={opt} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
          <Checkbox checked={list.includes(opt)} onCheckedChange={() => toggle(opt)} />
          {opt}
        </label>
      ))}
    </div>
  );
}

function Repeatable({ field, value, onChange }: { field: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const rows = (value as Answers[]) ?? [];
  const setRow = (i: number, patch: Answers) => {
    const next = [...rows];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  return (
    <div className="space-y-3">
      {rows.map((row, i) => (
        <div key={i} className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              {field.itemLabel ?? "Item"} {i + 1}
            </span>
            <Button type="button" variant="ghost" size="icon" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          {(field.itemFields ?? [])
            .filter((sf) => !sf.showIf || sf.showIf(row))
            .map((sf) => (
              <FieldInput key={sf.key} field={sf} value={row[sf.key]} scope={row} onChange={(v) => setRow(i, { [sf.key]: v })} />
            ))}
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, {}])}>
        <Plus className="mr-1 h-4 w-4" /> Add {(field.itemLabel ?? "item").toLowerCase()}
      </Button>
    </div>
  );
}

export function FieldInput({ field, value, scope, error, prefillValue, onChange }: Props) {
  const id = `f-${field.key}`;
  const chars = typeof value === "string" ? value.trim().length : 0;

  const control = () => {
    switch (field.type) {
      case "textarea":
        return <Textarea id={id} rows={5} value={(value as string) ?? ""} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
      case "select":
        return (
          <Select value={(value as string) ?? ""} onValueChange={onChange}>
            <SelectTrigger id={id}>
              <SelectValue placeholder="Choose one" />
            </SelectTrigger>
            <SelectContent>
              {(field.options ?? []).map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case "boolean":
        return (
          <div className="flex gap-2">
            <Button type="button" variant={value === true ? "default" : "outline"} size="sm" onClick={() => onChange(true)}>
              Yes
            </Button>
            <Button type="button" variant={value === false ? "default" : "outline"} size="sm" onClick={() => onChange(false)}>
              No
            </Button>
          </div>
        );
      case "confirm":
        return (
          <label className="flex items-start gap-3 rounded-md border border-border p-3 text-sm">
            <Checkbox checked={value === true} onCheckedChange={(c) => onChange(c === true)} />
            <span>
              {prefillValue ? <strong className="block">{prefillValue}</strong> : null}
              {field.label}
            </span>
          </label>
        );
      case "multiselect":
        return <MultiSelect options={field.options ?? []} value={value} onChange={onChange} />;
      case "rank":
        return <RankList options={field.options ?? []} value={value} onChange={onChange} />;
      case "hours":
        return <Hours value={value} onChange={onChange} />;
      case "geolist":
        return <GeoList value={value} onChange={onChange} />;
      case "repeatable":
        return <Repeatable field={field} value={value} onChange={onChange} />;
      case "number":
      case "currency":
        return (
          <Input
            id={id}
            type="number"
            inputMode="decimal"
            value={(value as number | string) ?? ""}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          />
        );
      case "date":
        return <Input id={id} type="date" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
      default:
        return (
          <Input
            id={id}
            type={field.type === "email" ? "email" : field.type === "tel" ? "tel" : "text"}
            value={(value as string) ?? ""}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
        );
    }
  };

  void scope;

  return (
    <div className="space-y-2">
      {field.type !== "confirm" && (
        <Label htmlFor={id} className="text-sm font-medium">
          {field.label}
          {field.required && <span className="ml-1 text-destructive">*</span>}
        </Label>
      )}
      {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
      {control()}
      <div className="flex items-center justify-between">
        {error ? <p className="text-xs text-destructive">{error}</p> : <span />}
        {field.minChars && (field.type === "text" || field.type === "textarea") ? (
          <span className={`text-xs ${chars < field.minChars ? "text-muted-foreground" : "text-muted-foreground/60"}`}>
            {chars}/{field.minChars}
          </span>
        ) : null}
      </div>
    </div>
  );
}
