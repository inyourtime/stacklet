import type { ReactNode } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogCancel,
} from "./ui/alert-dialog";

export function ErrorNotice({ message }: { message?: string }) {
  return message ? (
    <div className="error-notice" role="alert">
      <AlertCircle size={17} />
      <span>{message}</span>
    </div>
  ) : null;
}

export function SuccessNotice({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  if (!message) return null;

  return (
    <output className="success-notice">
      {message}
      <button type="button" onClick={onClose} aria-label="ปิดข้อความ">
        ×
      </button>
    </output>
  );
}

export function Loading() {
  return (
    <output className="loading">
      <Loader2 className="animate-spin" size={20} />
      กำลังโหลดข้อมูล…
    </output>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <Label asChild>
        <span>{label}</span>
      </Label>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  type = "text",
  ...rest
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  maxLength?: number;
  inputMode?: "decimal";
  step?: string;
}) {
  return (
    <Field label={label}>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
    </Field>
  );
}

export function Choice({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem value={o.value} key={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

export function Modal({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="form-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function Submit({
  pending,
  label = "บันทึก",
}: {
  pending: boolean;
  label?: string;
}) {
  return (
    <Button type="submit" disabled={pending} className="submit-button">
      {pending && <Loader2 className="animate-spin" size={16} />}{" "}
      {pending ? "กำลังบันทึก…" : label}
    </Button>
  );
}

export function Confirm({
  title,
  description,
  error,
  pending,
  onConfirm,
  onClose,
  confirmLabel = "ยืนยันการลบ",
}: {
  title: string;
  description: string;
  error?: string;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
  confirmLabel?: string;
}) {
  return (
    <AlertDialog
      open
      onOpenChange={(v) => {
        if (!v && !pending) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <ErrorNotice message={error} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>ยกเลิก</AlertDialogCancel>
          <Button variant="destructive" disabled={pending} onClick={onConfirm}>
            {pending ? "กำลังดำเนินการ…" : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export const assetLabels = {
  stock: "หุ้น",
  fund: "กองทุน",
  btc: "Bitcoin",
  cash: "เงินสด",
};
