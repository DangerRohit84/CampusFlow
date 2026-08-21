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
  return null;
}
