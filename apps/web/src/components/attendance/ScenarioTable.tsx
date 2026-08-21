interface Prediction {
  name: string;
  currentPercentage: number;
  ifAttendAll: number;
  ifMiss1PerWeek: number;
  ifMiss2PerWeek: number;
}

interface Props {
  predictions: Prediction[];
  target: number;
}

export default function ScenarioTable({ predictions, target }: Props) {
  const scenarios = [
    { label: 'Attend ALL remaining', key: 'ifAttendAll', style: 'bg-primary-50 dark:bg-primary-900/20 font-semibold' },
    { label: 'Miss 1 class/week', key: 'ifMiss1PerWeek', style: '' },
    { label: 'Miss 2 classes/week', key: 'ifMiss2PerWeek', style: '' },
    { label: 'Miss 1 full week', key: 'miss1Week', style: 'bg-danger-50 dark:bg-danger-900/20' },
  ];

  const getValue = (p: Prediction, key: string) => {
    if (key === 'miss1Week') {
      const classesMissed = 3;
      const futureClasses = 6 * 3;
      const futureMisses = classesMissed;
      const projected = (p.currentPercentage / 100 * 35 + (futureClasses - futureMisses)) / (35 + futureClasses) * 100;
      return Math.round(projected * 10) / 10;
    }
    return (p as any)[key];
  };

  return (
    <div className="bg-white dark:bg-[#111920] border border-surface-200 dark:border-[#202C35] rounded-xl overflow-hidden">
      <div className="p-4 border-b border-surface-200 dark:border-[#202C35]">
        <h3 className="font-semibold text-surface-900 dark:text-[#F4F7F8]">What-If Scenario Simulator</h3>
        <p className="text-xs text-surface-500 mt-1">See how your attendance changes based on different behavior patterns</p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface-50 dark:bg-[#0C1218]">
            <th className="text-left px-4 py-3">Scenario</th>
            {predictions.map((p) => (
              <th key={p.name} className="text-center px-4 py-3">{p.name}</th>
            ))}
            <th className="text-center px-4 py-3">Overall</th>
          </tr>
        </thead>
        <tbody>
          {scenarios.map((s) => {
            const overallAvg = predictions.reduce((acc, p) => acc + getValue(p, s.key), 0) / (predictions.length || 1);
            return (
              <tr key={s.key} className={`border-t border-surface-100 dark:border-[#202C35] ${s.style}`}>
                <td className="px-4 py-3 font-medium">{s.label}</td>
                {predictions.map((p) => {
                  const val = getValue(p, s.key);
                  return (
                    <td key={p.name} className="text-center px-4 py-3">
                      <span className={val >= target ? 'text-primary-600' : 'text-danger-600'}>
                        {Math.round(val * 10) / 10}%
                      </span>
                    </td>
                  );
                })}
                <td className="text-center px-4 py-3 font-bold">
                  <span className={overallAvg >= target ? 'text-primary-600' : 'text-danger-600'}>
                    {Math.round(overallAvg * 10) / 10}%
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
