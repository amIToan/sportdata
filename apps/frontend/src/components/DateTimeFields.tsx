'use client';

import { DatePicker, TimePicker, type DatePickerProps } from 'antd';
import type { Dayjs } from 'dayjs';

type DateTimeFieldsProps = Pick<DatePickerProps,
  'id' | 'disabled' | 'disabledDate' | 'defaultPickerValue' | 'onBlur' | 'size' | 'status' | 'allowClear'
> & {
  value?: Dayjs | null;
  onChange?: (value: Dayjs | null) => void;
  label: string;
  className?: string;
};

export function DateTimeFields({
  value, onChange, label, className = '', disabled, disabledDate, defaultPickerValue,
  onBlur, id, size = 'large', status, allowClear = true,
}: DateTimeFieldsProps) {
  return (
    <div
      className={`flex w-full flex-wrap gap-2 ${className}`}
      role="group"
      aria-label={label}
      onKeyDown={(event) => {
        // Enter accepts the date/time input without submitting the surrounding form.
        if (event.key === 'Enter') event.preventDefault();
      }}
    >
      <DatePicker
        id={id}
        className="min-w-36 flex-1"
        size={size}
        status={status}
        format="DD/MM/YYYY"
        placeholder="Chọn ngày"
        aria-label={`${label} · Ngày`}
        value={value}
        disabled={disabled}
        disabledDate={disabledDate}
        defaultPickerValue={defaultPickerValue}
        allowClear={allowClear}
        needConfirm={false}
        onBlur={onBlur}
        onChange={(date) => onChange?.(date
          ? date.hour(value?.hour() ?? 0).minute(value?.minute() ?? 0).second(0).millisecond(0)
          : null)}
      />
      <TimePicker
        className="w-28"
        size={size}
        status={status}
        format="HH:mm"
        placeholder="Chọn giờ"
        aria-label={`${label} · Giờ`}
        value={value}
        disabled={!value ? true : disabled}
        allowClear={false}
        needConfirm={false}
        onBlur={onBlur}
        onChange={(time) => {
          if (value && time) onChange?.(value.hour(time.hour()).minute(time.minute()).second(0).millisecond(0));
        }}
      />
    </div>
  );
}
