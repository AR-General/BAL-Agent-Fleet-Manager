import { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";
import type { Device } from "../types";
import { PageHeader } from "../components/common/PageHeader";
import { Modal } from "../components/common/Modal";
import { formatTs } from "../utils/instance";

export function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [edit, setEdit] = useState<Device | null>(null);
  const [form, setForm] = useState({
    name: "",
    device_type: "smartphone" as Device["deviceType"],
    serial_or_imei: "",
    notes: "",
  });

  const load = () => api<{ devices: Device[] }>("/devices").then((r) => setDevices(r.devices));

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, []);

  function openCreate() {
    setEdit(null);
    setForm({ name: "", device_type: "smartphone", serial_or_imei: "", notes: "" });
    setModalOpen(true);
  }

  function openEdit(d: Device) {
    setEdit(d);
    setForm({
      name: d.name,
      device_type: d.deviceType as Device["deviceType"],
      serial_or_imei: d.serialOrImei || "",
      notes: d.notes || "",
    });
    setModalOpen(true);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (edit) {
      await api(`/devices/${edit.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: form.name,
          serial_or_imei: form.serial_or_imei || undefined,
          notes: form.notes || undefined,
        }),
      });
    } else {
      await api("/devices", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          device_type: form.device_type,
          serial_or_imei: form.serial_or_imei || undefined,
          notes: form.notes || undefined,
        }),
      });
    }
    setModalOpen(false);
    load();
  }

  async function onDelete(id: string) {
    if (!confirm("Delete device?")) return;
    await api(`/devices/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <>
      <PageHeader
        title="Devices"
        subtitle="Phones, Signal devices, and softphones used by agents"
        actions={
          <button type="button" onClick={openCreate}>
            Add device
          </button>
        }
      />
      {error && <p className="badge bad">{error}</p>}

      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Serial / IMEI</th>
            <th>Notes</th>
            <th>Created</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {devices.map((d) => (
            <tr key={d.id}>
              <td>
                <strong>{d.name}</strong>
              </td>
              <td>{d.deviceType}</td>
              <td className="muted">{d.serialOrImei ?? "—"}</td>
              <td className="muted">{d.notes ?? "—"}</td>
              <td className="muted">{formatTs(d.createdAt)}</td>
              <td>
                <div className="row-actions">
                  <button type="button" className="secondary" onClick={() => openEdit(d)}>
                    Edit
                  </button>
                  <button type="button" className="danger" onClick={() => onDelete(d.id)}>
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Modal open={modalOpen} title={edit ? "Edit device" : "Add device"} onClose={() => setModalOpen(false)}>
        <form onSubmit={onSubmit} className="form-grid">
          <label>
            Name *
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            Type *
            <select
              value={form.device_type}
              disabled={!!edit}
              onChange={(e) => setForm({ ...form, device_type: e.target.value as Device["deviceType"] })}
            >
              <option value="smartphone">smartphone</option>
              <option value="esim_device">esim_device</option>
              <option value="signal_device">signal_device</option>
              <option value="softphone">softphone</option>
            </select>
          </label>
          <label>
            Serial / IMEI
            <input
              value={form.serial_or_imei}
              onChange={(e) => setForm({ ...form, serial_or_imei: e.target.value })}
            />
          </label>
          <label className="full">
            Notes
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
          <button type="submit">{edit ? "Save" : "Create"}</button>
        </form>
      </Modal>
    </>
  );
}
