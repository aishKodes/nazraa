"use client";

import { useEffect, useRef, useState } from "react";

export function ImageUploadField({
  name,
  label,
  hint,
  required = false,
  currentUrl,
}: {
  name: string;
  label: string;
  hint: string;
  required?: boolean;
  currentUrl?: string | null;
}) {
  const [preview, setPreview] = useState(currentUrl ?? "");
  const [objectUrl, setObjectUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  function selectFile(file: File) {
    if (!file.type.match(/^image\/(?:jpeg|png|webp)$/)) return;
    if (inputRef.current) {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      inputRef.current.files = transfer.files;
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    const next = URL.createObjectURL(file);
    setObjectUrl(next);
    setPreview(next);
  }

  return <label
    className={`image-upload-field${dragging ? " is-dragging" : ""}`}
    onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
    onDragOver={(event) => event.preventDefault()}
    onDragLeave={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
    }}
    onDrop={(event) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files[0];
      if (file) selectFile(file);
    }}
  >
    {label} <span>{hint}</span>
    <input
      ref={inputRef}
      name={name}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      required={required}
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) selectFile(file);
      }}
    />
    <span
      className={`image-upload-preview${preview ? " has-image" : ""}`}
      style={preview ? { backgroundImage: `url(${JSON.stringify(preview)})` } : undefined}
      aria-label={preview ? "Selected image preview" : "No image selected"}
    >{preview ? "" : "Drop an image here or choose a file"}</span>
  </label>;
}
