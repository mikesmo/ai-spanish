import { configure } from 'react-native-deepgram';
import HomeScreen from './screens/HomeScreen';
import { QueryProvider } from './src/providers/QueryProvider';

configure({ apiKey: process.env.EXPO_PUBLIC_DEEPGRAM_API_KEY! });

export default function App(): JSX.Element {
  return (
    <QueryProvider>
      <HomeScreen />
    </QueryProvider>
  );
}
