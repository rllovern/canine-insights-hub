import { useEffect } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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

function SortableRow({ id, index }: { id: string; index: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={`flex cursor-grab touch-none select-none items-center gap-2 rounded-md border bg-card p-3 active:cursor-grabbing ${isDragging ? "z-10 border-primary shadow-lg" : "border-border"}`}
    >
      <GripVertical className="h-4 w-4 text-muted-foreground" />
      <span className="w-6 text-sm text-muted-foreground">{index + 1}</span>
      <span className="flex-1 text-sm">{id}</span>
    </li>
  );
}

function RankList({ options, value, onChange }: { options: string[]; value: unknown; onChange: (v: unknown) => void }) {
  const valid = Array.isArray(value) && (value as string[]).length === options.length;
  const order: string[] = valid ? (value as string[]) : options;
  // The list looks ranked from the start, so record that default order as the answer.
  useEffect(() => {
    if (!valid && options.length > 0) onChange([...options]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid, options.join("|")]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    onChange(arrayMove(order, order.indexOf(String(e.active.id)), order.indexOf(String(e.over.id))));
  };
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Drag to reorder.</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ol className="space-y-2">
            {order.map((opt, i) => <SortableRow key={opt} id={opt} index={i} />)}
          </ol>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function Choice({ options, value, onChange }: { options: string[]; value: unknown; onChange: (v: unknown) => void }) {
  return (
    <div role="radiogroup" className="grid gap-2">
      {options.map((o) => {
        const [title, ...rest] = o.split(" — ");
        const active = value === o;
        return (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o)}
            className={`rounded-md border-2 p-3 text-left text-sm transition ${active ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
          >
            <span className="font-medium">{title}</span>
            {rest.length > 0 && <span className="block text-muted-foreground">{rest.join(" — ")}</span>}
          </button>
        );
      })}
    </div>
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
      case "radio":
        return <Choice options={field.options ?? []} value={value} onChange={onChange} />;
      case "rank":
        return <RankList options={field.options ?? []} value={value} onChange={onChange} />;
      case "hours":
        return <Hours value={value} onChange={onChange} />;
      case "geolist":
        return <GeoList value={value} onChange={onChange} />;
      case "repeatable":
        return <Repeatable field={field} value={value} onChange={onChange} />;
      case "visual_radio":
        return (
          <div role="radiogroup" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(field.choices ?? []).map((c) => {
              const active = value === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onChange(c.value)}
                  className={`overflow-hidden rounded-lg border-2 text-left transition ${active ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/50"}`}
                >
                  <img src={c.image} alt={c.label} loading="lazy" className="aspect-[3/2] w-full object-cover" />
                  <span className="block px-3 py-2 text-sm font-medium">{c.label}</span>
                </button>
              );
            })}
          </div>
        );
      case "number":
      case "currency":
        return (
          <div className="flex items-center gap-2">
            <Input
              id={id}
              type="number"
              inputMode="decimal"
              className={field.suffix ? "w-32" : undefined}
              value={(value as number | string) ?? ""}
              placeholder={field.placeholder}
              onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
            />
            {field.suffix && <span className="text-sm text-muted-foreground">{field.suffix}</span>}
          </div>
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
