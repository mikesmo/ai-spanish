import { configure } from 'react-native-deepgram';
import HomeScreen from './screens/HomeScreen';

configure({ apiKey: process.env.EXPO_PUBLIC_DEEPGRAM_API_KEY! });

export default HomeScreen;
