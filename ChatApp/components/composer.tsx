import Ionicons from "@expo/vector-icons/Ionicons";
import * as DocumentPicker from "expo-document-picker";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconButton, webNoOutline } from "@/components/ui";
import { ALLOWED_UPLOAD_TYPES, MAX_MESSAGE_LENGTH, MAX_UPLOAD_BYTES } from "@/lib/config";
import { formatFileSize } from "@/lib/format";
import { radius, space, useTheme } from "@/lib/theme";
import type { LocalFile } from "@/lib/types";

const TYPING_REFRESH_MS = 2500;
const TYPING_IDLE_MS = 3000;

const EXTENSION_TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  pdf: "application/pdf", txt: "text/plain", csv: "text/csv", zip: "application/zip",
};

function guessMimeType(name: string, given?: string | null) {
  if (given) return given;
  return EXTENSION_TYPES[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

export type ComposerContext =
  | { kind: "reply"; title: string; text: string }
  | { kind: "edit"; text: string }
  | null;

type Props = {
  context: ComposerContext;
  onCancelContext: () => void;
  onSend: (text: string, file: LocalFile | null) => void;
  onTyping: (isTyping: boolean) => void;
  disabled?: boolean;
};

export function Composer({ context, onCancelContext, onSend, onTyping, disabled }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState("");
  const [file, setFile] = useState<LocalFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [height, setHeight] = useState(0);
  const inputRef = useRef<TextInput>(null);
  const typingSentAt = useRef(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isEditing = context?.kind === "edit";

  // Entering edit mode loads the message text (and leaving it clears it); replying focuses the input.
  const previousKind = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (context?.kind === "edit") {
      setText(context.text);
      setFile(null);
    } else if (previousKind.current === "edit") {
      setText("");
    }
    previousKind.current = context?.kind;
    if (context) inputRef.current?.focus();
  }, [context]);

  useEffect(
    () => () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    },
    []
  );

  const stopTyping = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = null;
    if (typingSentAt.current) {
      typingSentAt.current = 0;
      onTyping(false);
    }
  };

  const handleChange = (value: string) => {
    setText(value);
    setError(null);
    if (isEditing) return;
    if (!value.trim()) return stopTyping();
    const now = Date.now();
    if (now - typingSentAt.current > TYPING_REFRESH_MS) {
      typingSentAt.current = now;
      onTyping(true);
    }
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  };

  const acceptFile = (candidate: LocalFile) => {
    if (!ALLOWED_UPLOAD_TYPES.includes(candidate.mimeType)) {
      setError("That file type isn't supported. Try a photo, PDF, Office document, text file or zip.");
      return;
    }
    if (candidate.size > MAX_UPLOAD_BYTES) {
      setError(`Files must be smaller than ${formatFileSize(MAX_UPLOAD_BYTES)}.`);
      return;
    }
    setError(null);
    setFile(candidate);
  };

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const name = asset.fileName || `photo-${Date.now()}.jpg`;
      acceptFile({
        uri: asset.uri,
        name,
        mimeType: guessMimeType(name, asset.mimeType),
        size: asset.fileSize ?? asset.file?.size ?? 0,
        file: asset.file,
      });
    } catch {
      setError("Couldn't open your photos. Check the app's photo permission.");
    }
  };

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      acceptFile({
        uri: asset.uri,
        name: asset.name,
        mimeType: guessMimeType(asset.name, asset.mimeType),
        size: asset.size ?? asset.file?.size ?? 0,
        file: asset.file,
      });
    } catch {
      setError("Couldn't open that file.");
    }
  };

  const trimmed = text.trim();
  const tooLong = text.length > MAX_MESSAGE_LENGTH;
  const canSend = !disabled && !tooLong && (trimmed.length > 0 || (!!file && !isEditing));

  const submit = () => {
    if (!canSend) return;
    onSend(trimmed, file);
    stopTyping();
    setText("");
    setFile(null);
    setHeight(0);
  };

  const contextBar = context && (
    <View style={[styles.context, { borderLeftColor: colors.primary, backgroundColor: colors.surfaceAlt }]}>
      <Ionicons name={context.kind === "edit" ? "pencil" : "arrow-undo"} size={16} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.contextTitle, { color: colors.primary }]}>
          {context.kind === "edit" ? "Editing message" : `Replying to ${context.title}`}
        </Text>
        {context.kind === "reply" && (
          <Text style={[styles.contextText, { color: colors.textMuted }]} numberOfLines={1}>
            {context.text}
          </Text>
        )}
      </View>
      <IconButton
        icon="close"
        label={context.kind === "edit" ? "Cancel editing" : "Cancel reply"}
        size={18}
        onPress={onCancelContext}
      />
    </View>
  );

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, space.sm) },
      ]}
    >
      {contextBar}
      {file && (
        <View style={[styles.attachment, { backgroundColor: colors.surfaceAlt }]}>
          {file.mimeType.startsWith("image/") ? (
            <Image source={{ uri: file.uri }} style={styles.attachmentThumb} contentFit="cover" />
          ) : (
            <View style={[styles.attachmentThumb, styles.attachmentDoc, { backgroundColor: colors.primarySoft }]}>
              <Ionicons name="document-text-outline" size={22} color={colors.primary} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={[styles.contextTitle, { color: colors.text }]} numberOfLines={1}>
              {file.name}
            </Text>
            <Text style={[styles.contextText, { color: colors.textMuted }]}>{formatFileSize(file.size)}</Text>
          </View>
          <IconButton icon="close" label="Remove attachment" size={18} onPress={() => setFile(null)} />
        </View>
      )}
      {error && (
        <Text style={[styles.error, { color: colors.danger }]} accessibilityLiveRegion="polite">
          {error}
        </Text>
      )}
      <View style={styles.inputRow}>
        {!isEditing && (
          <>
            <IconButton icon="image-outline" label="Attach a photo" onPress={pickImage} disabled={disabled} />
            <IconButton icon="attach" label="Attach a file" onPress={pickDocument} disabled={disabled} />
          </>
        )}
        <View style={[styles.inputWrap, { backgroundColor: colors.surfaceAlt, borderColor: tooLong ? colors.danger : colors.border }]}>
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={handleChange}
            placeholder={isEditing ? "Edit message" : "Message"}
            placeholderTextColor={colors.textFaint}
            multiline
            editable={!disabled}
            accessibilityLabel="Message"
            onContentSizeChange={e => setHeight(e.nativeEvent.contentSize.height)}
            onKeyPress={e => {
              // Desktop convention: Enter sends, Shift+Enter adds a new line.
              const event = e.nativeEvent as unknown as { key: string; shiftKey?: boolean };
              if (Platform.OS === "web" && event.key === "Enter" && !event.shiftKey) {
                e.preventDefault();
                submit();
              }
              if (event.key === "Escape" && context) onCancelContext();
            }}
            onBlur={stopTyping}
            style={[styles.input, { color: colors.text, height: Math.min(Math.max(22, height), 120) }, webNoOutline]}
          />
        </View>
        <IconButton
          icon={isEditing ? "checkmark" : "send"}
          label={isEditing ? "Save edit" : "Send message"}
          filled
          size={18}
          disabled={!canSend}
          onPress={submit}
        />
      </View>
      {text.length > MAX_MESSAGE_LENGTH - 500 && (
        <Text style={[styles.counter, { color: tooLong ? colors.danger : colors.textFaint }]}>
          {text.length} / {MAX_MESSAGE_LENGTH}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm, paddingHorizontal: space.sm },
  context: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    borderLeftWidth: 3,
    borderRadius: radius.sm,
    paddingLeft: space.md,
    paddingVertical: 4,
    marginHorizontal: space.xs,
    marginBottom: space.sm,
  },
  contextTitle: { fontSize: 13, fontWeight: "700" },
  contextText: { fontSize: 13 },
  attachment: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    borderRadius: radius.md,
    padding: space.sm,
    marginHorizontal: space.xs,
    marginBottom: space.sm,
  },
  attachmentThumb: { width: 44, height: 44, borderRadius: radius.sm },
  attachmentDoc: { alignItems: "center", justifyContent: "center" },
  error: { fontSize: 13, marginHorizontal: space.sm, marginBottom: space.sm },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 2 },
  inputWrap: {
    flex: 1,
    borderRadius: 21,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    paddingVertical: 9,
    marginHorizontal: space.xs,
    minHeight: 40,
    justifyContent: "center",
  },
  input: { fontSize: 16, lineHeight: 22, padding: 0 },
  counter: { fontSize: 12, textAlign: "right", marginRight: space.xxl + space.xl, marginTop: 2 },
});
