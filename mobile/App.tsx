import * as DocumentPicker from "expo-document-picker";
import { StatusBar } from "expo-status-bar";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";

type PickedPdf = {
  uri: string;
  name: string;
  mimeType: string;
};

type HealthResponse = {
  ok?: boolean;
};

type FieldsResponse = {
  fields?: string[];
  error?: string;
};

const DEFAULT_BASE_URL =
  Platform.OS === "android" ? "http://10.0.2.2:3000" : "http://localhost:3000";

const SAMPLE_ROWS_JSON = JSON.stringify(
  [
    {
      __filename: "sample-output",
      first_name: "Jane",
      last_name: "Doe"
    }
  ],
  null,
  2
);

function trimTrailingSlash(url: string) {
  return url.replace(/\/+$/, "");
}

function buildPdfPart(pdf: PickedPdf) {
  return {
    uri: pdf.uri,
    name: pdf.name,
    type: pdf.mimeType || "application/pdf"
  } as any;
}

export default function App() {
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_BASE_URL);
  const [pickedPdf, setPickedPdf] = useState<PickedPdf | null>(null);
  const [fields, setFields] = useState<string[]>([]);
  const [rowsJson, setRowsJson] = useState(SAMPLE_ROWS_JSON);
  const [status, setStatus] = useState("Ready.");
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [loadingFields, setLoadingFields] = useState(false);
  const [loadingGenerate, setLoadingGenerate] = useState(false);

  const apiRoot = useMemo(() => trimTrailingSlash(apiBaseUrl.trim()), [apiBaseUrl]);

  const choosePdf = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        copyToCacheDirectory: true,
        multiple: false
      });

      if (result.canceled) {
        return;
      }

      const file = result.assets[0];
      setPickedPdf({
        uri: file.uri,
        name: file.name || "template.pdf",
        mimeType: file.mimeType || "application/pdf"
      });
      setStatus(`Selected ${file.name || "template.pdf"}.`);
    } catch (error) {
      setStatus("Failed to choose a PDF file.");
      Alert.alert("Error", "Could not open the file picker.");
    }
  };

  const checkHealth = async () => {
    setLoadingHealth(true);
    try {
      const response = await fetch(`${apiRoot}/api/health`);
      const data = (await response.json()) as HealthResponse;

      if (!response.ok || !data.ok) {
        throw new Error("Backend did not return OK.");
      }

      setStatus(`Backend is healthy at ${apiRoot}.`);
    } catch (error) {
      setStatus("Health check failed. Verify URL and server status.");
      Alert.alert("Health Check Failed", "Cannot reach backend API.");
    } finally {
      setLoadingHealth(false);
    }
  };

  const detectFields = async () => {
    if (!pickedPdf) {
      Alert.alert("Missing PDF", "Choose a PDF template first.");
      return;
    }

    setLoadingFields(true);
    setStatus("Detecting PDF fields...");

    try {
      const formData = new FormData();
      formData.append("pdf", buildPdfPart(pickedPdf));

      const response = await fetch(`${apiRoot}/api/fields`, {
        method: "POST",
        body: formData
      });

      const data = (await response.json()) as FieldsResponse;
      if (!response.ok) {
        throw new Error(data.error || "Field detection failed.");
      }

      const nextFields = Array.isArray(data.fields) ? data.fields : [];
      setFields(nextFields);
      setStatus(`Detected ${nextFields.length} fields.`);
    } catch (error) {
      setStatus("Field detection failed.");
      Alert.alert("Field Detection Failed", "Unable to read fields from this PDF.");
    } finally {
      setLoadingFields(false);
    }
  };

  const generatePdf = async () => {
    if (!pickedPdf) {
      Alert.alert("Missing PDF", "Choose a PDF template first.");
      return;
    }

    let rows: unknown;
    try {
      rows = JSON.parse(rowsJson);
      if (!Array.isArray(rows)) {
        throw new Error("Rows must be an array.");
      }
    } catch (error) {
      Alert.alert("Invalid JSON", "Rows JSON must be a valid array.");
      return;
    }

    setLoadingGenerate(true);
    setStatus("Generating filled PDF...");

    try {
      const formData = new FormData();
      formData.append("pdf", buildPdfPart(pickedPdf));
      formData.append("rows", JSON.stringify(rows));

      const response = await fetch(`${apiRoot}/api/generate`, {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Generation failed." }));
        throw new Error(err.error || "Generation failed.");
      }

      const blob = await response.blob();
      const kb = Math.max(1, Math.round(blob.size / 1024));
      setStatus(`Generated PDF received (${kb} KB).`);
      Alert.alert("Success", "PDF generated. File save/share is next step.");
    } catch (error) {
      setStatus("PDF generation failed.");
      Alert.alert("Generation Failed", (error as Error).message || "Request failed.");
    } finally {
      setLoadingGenerate(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Field It Mobile</Text>
        <Text style={styles.subtitle}>Cross-platform starter for iOS and Android</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Backend Base URL</Text>
          <TextInput
            value={apiBaseUrl}
            onChangeText={setApiBaseUrl}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            placeholder="http://192.168.1.10:3000"
            placeholderTextColor="#98a2b3"
          />
          <Text style={styles.hint}>
            Android emulator usually uses http://10.0.2.2:3000 for local backend.
          </Text>
          <Pressable style={styles.primaryButton} onPress={checkHealth} disabled={loadingHealth}>
            {loadingHealth ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.buttonText}>Check Health</Text>}
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>PDF Template</Text>
          <Pressable style={styles.secondaryButton} onPress={choosePdf}>
            <Text style={styles.secondaryButtonText}>Choose PDF</Text>
          </Pressable>
          <Text style={styles.valueText}>{pickedPdf ? pickedPdf.name : "No file selected"}</Text>

          <Pressable style={styles.primaryButton} onPress={detectFields} disabled={loadingFields || !pickedPdf}>
            {loadingFields ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.buttonText}>Detect Fields</Text>}
          </Pressable>

          <Text style={styles.label}>Detected Fields ({fields.length})</Text>
          <View style={styles.fieldList}>
            {fields.length === 0 ? (
              <Text style={styles.hint}>No fields detected yet.</Text>
            ) : (
              fields.slice(0, 20).map((field) => (
                <Text key={field} style={styles.fieldItem}>
                  {field}
                </Text>
              ))
            )}
            {fields.length > 20 ? (
              <Text style={styles.hint}>Showing first 20 fields.</Text>
            ) : null}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Rows JSON Payload</Text>
          <TextInput
            value={rowsJson}
            onChangeText={setRowsJson}
            multiline
            style={styles.codeInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable style={styles.primaryButton} onPress={generatePdf} disabled={loadingGenerate || !pickedPdf}>
            {loadingGenerate ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.buttonText}>Generate PDF</Text>}
          </Pressable>
        </View>

        <View style={styles.statusBox}>
          <Text style={styles.statusText}>{status}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#0f172a"
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 28,
    paddingTop: 12,
    gap: 14
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#f8fafc"
  },
  subtitle: {
    fontSize: 14,
    color: "#cbd5e1"
  },
  card: {
    backgroundColor: "#1e293b",
    borderRadius: 12,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: "#334155"
  },
  label: {
    color: "#e2e8f0",
    fontSize: 14,
    fontWeight: "600"
  },
  input: {
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 8,
    backgroundColor: "#0f172a",
    color: "#f8fafc",
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  valueText: {
    color: "#cbd5e1"
  },
  hint: {
    color: "#94a3b8",
    fontSize: 12
  },
  primaryButton: {
    backgroundColor: "#0284c7",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center"
  },
  secondaryButton: {
    backgroundColor: "#334155",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center"
  },
  buttonText: {
    color: "#ffffff",
    fontWeight: "600"
  },
  secondaryButtonText: {
    color: "#e2e8f0",
    fontWeight: "600"
  },
  fieldList: {
    maxHeight: 180,
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 8,
    backgroundColor: "#0f172a",
    padding: 8,
    gap: 4
  },
  fieldItem: {
    color: "#cbd5e1",
    fontSize: 12
  },
  codeInput: {
    minHeight: 140,
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 8,
    backgroundColor: "#020617",
    color: "#e2e8f0",
    fontFamily: Platform.select({ ios: "Courier", android: "monospace", default: "monospace" }),
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlignVertical: "top"
  },
  statusBox: {
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 8,
    backgroundColor: "#1e293b",
    padding: 10
  },
  statusText: {
    color: "#e2e8f0"
  }
});
