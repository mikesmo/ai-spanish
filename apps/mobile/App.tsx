import HomeScreen from './screens/HomeScreen';
import { QueryProvider } from './src/providers/QueryProvider';

export default function App(): JSX.Element {
  return (
    <QueryProvider>
      <HomeScreen />
    </QueryProvider>
  );
}
