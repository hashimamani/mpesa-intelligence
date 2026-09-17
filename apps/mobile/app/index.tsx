import { Text, View } from "react-native";

// Placeholder screen — proves the Expo app boots and resolves workspace
// packages. Real onboarding/upload flow (docs/02-user-journeys.md) is built
// at Stage 14 (mobile polish) once auth and design system exist.

export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text>M-Pesa Financial Intelligence</Text>
    </View>
  );
}
