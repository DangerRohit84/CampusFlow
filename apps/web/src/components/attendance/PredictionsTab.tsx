import { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle, TrendingDown, Target } from 'lucide-react';
import { attendanceAPI } from '../../lib/api';
import FrequencyEditor from './FrequencyEditor';
import ScenarioTable from './ScenarioTable';

interface Prediction {
  name: string;
  total: number;
  present: number;
  currentPercentage: number;
  safeToSkip: number;
  ifAttendAll: number;
  ifMiss1PerWeek: number;
  ifMiss2PerWeek: number;
  riskLevel: 'SAFE' | 'WARNING' | 'AT_RISK';
  recoveryClasses: number | null;
}

const RISK_STYLES = {
  SAFE: { bg: 'bg-primary-50 dark:bg-primary-900/20', text: 'text-primary-700 dark:text-primary-400', label: 'SAFE', icon: CheckCircle },
  WARNING: { bg: 'bg-warning-50 dark:bg-warning-900/20', text: 'text-warning-700 dark:text-warning-400', label: 'WARNING', icon: AlertTriangle },
  AT_RISK: { bg: 'bg-danger-50 dark:bg-danger-900/20', text: 'text-danger-700 dark:text-danger-400', label: 'AT RISK', icon: TrendingDown },
};

interface SubjectFreq {
  name: string;
  classesPerWeek: number;
  hasLab: boolean;
  hasMakeup: boolean;
}

export default function PredictionsTab() {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [overall, setOverall] = useState<any>(null);
  const [subjects, setSubjects] = useState<SubjectFreq[]>([]);
  const [subjectData, setSubjectData] = useState<Record<string, { total: number; present: number }>>({});
  const [target, setTarget] = useState(75);
  const [loading, setLoading] = useState(false);
  const [noData, setNoData] = useState(false);

  const fetchHistory = async () => {
    try {
      const result = await attendanceAPI.getHistory();
      const history = result.history || [];

      // Aggregate all records across all dates by subject
      const subjectTotals: Record<string, { total: number; present: number }> = {};
      for (const entry of history) {
        for (const rec of entry.records || []) {
          const subj = rec.subject;
          if (!subjectTotals[subj]) {
            subjectTotals[subj] = { total: 0, present: 0 };
          }
          subjectTotals[subj].total += 1;
          if (rec.status === 'PRESENT' || rec.status === 'EXCUSED') {
            subjectTotals[subj].present += 1;
          }
        }
      }

      const subjectNames = Object.keys(subjectTotals);
      if (subjectNames.length === 0) {
        setNoData(true);
        setPredictions([]);
        setOverall(null);
        return;
      }

      setNoData(false);
      setSubjectData(subjectTotals);

      // Build subjects list with default class frequency for new subjects
      setSubjects((prev) => {
        const existingMap = new Map(prev.map((s) => [s.name, s]));
        return subjectNames.map((name) => {
          const existing = existingMap.get(name);
          return existing || { name, classesPerWeek: 3, hasLab: false, hasMakeup: false };
        });
      });
    } catch (err) {
      console.error('Failed to fetch attendance history:', err);
      setNoData(true);
    }
  };

  const fetchPredictions = async () => {
    setLoading(true);
    try {
      const predictSubjects = subjects
        .filter((s) => subjectData[s.name])
        .map((s) => ({
          name: s.name,
          total: subjectData[s.name].total,
          present: subjectData[s.name].present,
          classesPerWeek: s.classesPerWeek,
          weeksRemaining: 6,
        }));

      if (predictSubjects.length === 0) {
        setPredictions([]);
        setOverall(null);
        return;
      }

      const result = await attendanceAPI.predict(predictSubjects, target);
      // Enrich predictions with total/present from subject data
      const enriched = result.predictions.map((p: any) => ({
        ...p,
        total: subjectData[p.name]?.total || 0,
        present: subjectData[p.name]?.present || 0,
      }));
      setPredictions(enriched);
      setOverall(result.overall);
    } catch (err) {
      console.error('Predict failed:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  useEffect(() => {
    if (subjects.length > 0) {
      fetchPredictions();
    }
  }, [subjects, target]);

  return (
    <div className="space-y-6">
      {noData && (
        <div className="p-6 rounded-xl bg-surface-50 dark:bg-[#111920] border border-surface-200 dark:border-[#202C35] text-center">
          <Target className="w-10 h-10 text-surface-300 mx-auto mb-3" />
          <p className="text-surface-600 dark:text-[#A6B3BE] font-medium">No attendance records found</p>
          <p className="text-sm text-surface-400 dark:text-[#A6B3BE] mt-1">Upload or manually enter attendance data to see predictions.</p>
        </div>
      )}

      {overall && (
        <div className={`p-4 rounded-xl flex items-center gap-3 ${
          overall.riskLevel === 'SAFE' ? 'bg-primary-50 dark:bg-primary-900/20' :
          overall.riskLevel === 'WARNING' ? 'bg-warning-50 dark:bg-warning-900/20' :
          'bg-danger-50 dark:bg-danger-900/20'
        }`}>
          {overall.riskLevel === 'SAFE' ? <CheckCircle className="w-6 h-6 text-primary-600" /> :
           overall.riskLevel === 'WARNING' ? <AlertTriangle className="w-6 h-6 text-warning-600" /> :
           <TrendingDown className="w-6 h-6 text-danger-600" />}
          <div>
            <div className="font-bold text-surface-900 dark:text-[#F4F7F8]">
              {overall.riskLevel === 'SAFE' ? 'All Good' :
               overall.riskLevel === 'WARNING' ? 'Warning — Approaching threshold' :
               'At Risk — Action needed'}
            </div>
            <div className="text-sm text-surface-600 dark:text-[#A6B3BE]">
              Overall: {overall.currentPercentage}% (Target: {target}%)
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <h3 className="font-semibold text-surface-900 dark:text-[#F4F7F8]">Subject-wise Analysis</h3>
        {predictions.map((p) => {
          const risk = RISK_STYLES[p.riskLevel];
          const Icon = risk.icon;
          return (
            <div key={p.name} className="bg-white dark:bg-[#111920] border border-surface-200 dark:border-[#202C35] rounded-xl p-4">
              <div className="flex justify-between items-center mb-3">
                <div>
                  <div className="font-semibold text-surface-900 dark:text-[#F4F7F8]">{p.name}</div>
                  <div className="text-xs text-surface-500">{subjects.find((s) => s.name === p.name)?.classesPerWeek || 3} classes/week</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded-full text-xs font-bold ${risk.bg} ${risk.text}`}>
                    {risk.label}
                  </span>
                  <span className="text-2xl font-bold text-surface-900 dark:text-[#F4F7F8]">{p.currentPercentage}%</span>
                </div>
              </div>
              <div className="h-1.5 bg-surface-100 dark:bg-[#202C35] rounded-full overflow-hidden mb-3">
                <div
                  className={`h-full rounded-full ${
                    p.riskLevel === 'SAFE' ? 'bg-primary-500' :
                    p.riskLevel === 'WARNING' ? 'bg-warning-500' : 'bg-danger-500'
                  }`}
                  style={{ width: `${Math.min(100, p.currentPercentage)}%` }}
                />
              </div>
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                <div className="p-2 bg-surface-50 dark:bg-[#0C1218] rounded-lg">
                  <div className="text-surface-500">Attended</div>
                  <div className="font-bold text-surface-900 dark:text-[#F4F7F8]">
                    {p.present}/{p.total}
                  </div>
                </div>
                <div className={`p-2 rounded-lg ${p.riskLevel === 'SAFE' ? 'bg-primary-50 dark:bg-primary-900/20' : 'bg-warning-50 dark:bg-warning-900/20'}`}>
                  <div className="text-surface-500">{p.riskLevel === 'SAFE' ? 'Safe to Skip' : 'Must Attend'}</div>
                  <div className={`font-bold ${p.riskLevel === 'SAFE' ? 'text-primary-600' : 'text-warning-600'}`}>
                    {p.riskLevel === 'SAFE' ? `${p.safeToSkip} classes` : `${p.recoveryClasses} classes`}
                  </div>
                </div>
                <div className="p-2 bg-surface-50 dark:bg-[#0C1218] rounded-lg">
                  <div className="text-surface-500">If miss 1/wk</div>
                  <div className={`font-bold ${p.ifMiss1PerWeek >= target ? 'text-primary-600' : 'text-danger-600'}`}>
                    → {p.ifMiss1PerWeek}%
                  </div>
                </div>
                <div className="p-2 bg-surface-50 dark:bg-[#0C1218] rounded-lg">
                  <div className="text-surface-500">If miss 2/wk</div>
                  <div className={`font-bold ${p.ifMiss2PerWeek >= target ? 'text-primary-600' : 'text-danger-600'}`}>
                    → {p.ifMiss2PerWeek}%
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-white dark:bg-[#111920] border border-surface-200 dark:border-[#202C35] rounded-xl p-4">
        <h3 className="font-semibold text-surface-900 dark:text-[#F4F7F8] mb-3">Weekly Class Frequency</h3>
        <FrequencyEditor subjects={subjects} onChange={setSubjects} />
      </div>

      <ScenarioTable predictions={predictions} target={target} subjects={subjects} />
    </div>
  );
}
