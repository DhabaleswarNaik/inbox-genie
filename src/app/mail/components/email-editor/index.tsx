"use client";

import GhostExtension from "./extension";
import React from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Text from "@tiptap/extension-text";

import TipTapMenuBar from "./menu-bar";
import { Button } from "@/components/ui/button";
import { generate } from "./action";
import { readStreamableValue } from "ai/rsc";
import { Separator } from "@/components/ui/separator";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { useLocalStorage } from "usehooks-ts";
import { api } from "@/trpc/react";
import { Input } from "@/components/ui/input";
import TagInput from "./tag-input";
import AIComposeButton from "./ai-compose-button";

type EmailEditorProps = {
    toValues: { label: string; value: string }[];
    ccValues: { label: string; value: string }[];

    subject: string;
    setSubject: (subject: string) => void;
    to: string[];
    handleSend: (value: string) => void;
    isSending: boolean;

    onToChange: (values: { label: string; value: string }[]) => void;
    onCcChange: (values: { label: string; value: string }[]) => void;

    defaultToolbarExpand?: boolean;
};

const EmailEditor = ({
    toValues,
    ccValues,
    subject,
    setSubject,
    to,
    handleSend,
    isSending,
    onToChange,
    onCcChange,
    defaultToolbarExpand,
}: EmailEditorProps) => {

    // Prevent SSR hydration issues by delaying render
    const [mounted, setMounted] = React.useState(false);
    React.useEffect(() => setMounted(true), []);


    const [ref] = useAutoAnimate();
    const [accountId] = useLocalStorage("accountId", "");

    const { data: suggestions } = api.mail.getEmailSuggestions.useQuery(
        { accountId: accountId, query: "" },
        { enabled: !!accountId }
    );

    const [expanded, setExpanded] = React.useState(defaultToolbarExpand ?? false);
    const [generation, setGeneration] = React.useState("");

    // AI generate text
    const aiGenerate = async (prompt: string) => {
        const { output } = await generate(prompt);

        for await (const delta of readStreamableValue(output)) {
            if (delta) setGeneration(delta);
        }
    };

    // Extend Text to add keyboard shortcut
    const customText = Text.extend({
        addKeyboardShortcuts() {
            return {
                "Meta-j": () => {
                    aiGenerate(this.editor.getText());
                    return true;
                },
            };
        },
    });

    // Safely create TipTap editor with SSR disabled
    const editor = useEditor({
        immediatelyRender: false,
        autofocus: false,
        extensions: [StarterKit, customText, GhostExtension],
        editorProps: {
            attributes: {
                class: "focus:outline-none",
            },
        },
    });

    // Insert AI-generated content into editor
    React.useEffect(() => {
        if (!generation || !editor) return;
        editor.commands.insertContent(generation);
    }, [generation, editor]);

    // Handle global shortcuts
    React.useEffect(() => {
        if (!editor) return;

        const handler = (event: KeyboardEvent) => {
            const active = document.activeElement?.tagName;

            if (event.key === "Enter" && !["INPUT", "TEXTAREA", "SELECT"].includes(active || "")) {
                editor.commands.focus();
            }
            if (event.key === "Escape") {
                editor.commands.blur();
            }
        };

        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [editor]);
    if (!mounted) return null;


    return (
        <div>
            {/* Toolbar */}
            <div className="flex p-4 py-2 border-b">
                {editor && <TipTapMenuBar editor={editor} />}
            </div>

            {/* To, Cc, Subject */}
            <div ref={ref} className="p-4 pb-0 space-y-2">
                {expanded && (
                    <>
                        <TagInput
                            suggestions={suggestions?.map((s) => s.address) || []}
                            value={toValues}
                            placeholder="Add tags"
                            label="To"
                            onChange={onToChange}
                        />
                        <TagInput
                            suggestions={suggestions?.map((s) => s.address) || []}
                            value={ccValues}
                            placeholder="Add tags"
                            label="Cc"
                            onChange={onCcChange}
                        />
                        <Input
                            id="subject"
                            className="w-full"
                            placeholder="Subject"
                            value={subject}
                            onChange={(e) => setSubject(e.target.value)}
                        />
                    </>
                )}

                {/* Header */}
                <div className="flex items-center gap-2">
                    <div
                        className="cursor-pointer"
                        onClick={() => setExpanded((e) => !e)}
                    >
                        <span className="text-green-600 font-medium">Draft </span>
                        <span>to {to.join(", ")}</span>
                    </div>

                    <AIComposeButton
                        isComposing={defaultToolbarExpand}
                        onGenerate={setGeneration}
                    />
                </div>
            </div>

            {/* Email Editor */}
            <div className="prose w-full px-4">
                <EditorContent editor={editor} placeholder="Write your email here..." />
            </div>

            <Separator />

            {/* Footer */}
            <div className="py-3 px-4 flex items-center justify-between">
                <span className="text-sm">
                    Tip: Press{" "}
                    <kbd className="px-2 py-1.5 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-200 rounded-lg">
                        Cmd + J
                    </kbd>{" "}
                    for AI autocomplete
                </span>

                <Button
                    onClick={async () => {
                        const html = editor?.getHTML() || "";
                        editor?.commands.clearContent();
                        await handleSend(html);
                    }}
                    isLoading={isSending}
                >
                    Send
                </Button>
            </div>
        </div>
    );
};

export default EmailEditor;
