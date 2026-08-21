import { Minus, Plus } from 'lucide-react';

interface SubjectFreq {
  name: string;
  classesPerWeek: number;
  hasLab: boolean;
  hasMakeup: boolean;
}

interface Props {
  subjects: SubjectFreq[];
  onChange: (subjects: SubjectFreq[]) => void;
}

export default function FrequencyEditor({ subjects, onChange }: Props) {
  const update = (index: number, field: keyof SubjectFreq, value: any) => {
    const updated = subjects.map((s, i) => i === index ? { ...s, [field]: value } : s);
    onChange(updated);
  };

  const increment = (index: number) => {
    update(index, 'classesPerWeek', Math.min(10, subjects[index].classesPerWeek + 1));
  };

  const decrement = (index: number) => {
    update(index, 'classesPerWeek', Math.max(1, subjects[index].classesPerWeek - 1));
  };

  return (
    <div className="space-y-2">
      {subjects.map((s, i) => (
        <div key={i} className="flex items-center gap-3 p-3 bg-surface-50 dark:bg-[#111920] rounded-lg">
          <div className="w-2 h-2 rounded-full bg-primary-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-surface-900 dark:text-[#F4F7F8]">{s.name}</div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => decrement(i)} className="w-7 h-7 border border-surface-300 dark:border-[#202C35] rounded-md flex items-center justify-center text-surface-500 hover:bg-surface-100">
              <Minus className="w-3 h-3" />
            </button>
            <div className="w-10 h-7 border border-primary-500 rounded-md flex items-center justify-center font-bold text-primary-600 text-sm">
              {s.classesPerWeek}
            </div>
            <button onClick={() => increment(i)} className="w-7 h-7 border border-surface-300 dark:border-[#202C35] rounded-md flex items-center justify-center text-surface-500 hover:bg-surface-100">
              <Plus className="w-3 h-3" />
            </button>
          </div>
          <span className="text-xs text-surface-500 w-16 text-right">classes/wk</span>
        </div>
      ))}
    </div>
  );
}
