import React, { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { useLocation, useSearch } from "wouter";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { FileText, FileUp, ListChecks, BrainCircuit, Loader2, CheckCircle2, MessageSquare, ArrowRight, RotateCcw, Target, Trophy, XCircle, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SpeechButton } from "@/components/speech-button";
import { SlideViewer } from "@/components/slide-viewer";
import { cn } from "@/lib/utils";
import {
  useListStudyMaterials,
  useCreateStudyMaterial,
  useDeleteStudyMaterial,
  useGenerateQuiz,
  type QuizQuestion,
  type Quiz
} from "@workspace/api-client-react";
import { Trash2 } from "lucide-react";
import { streamOpenAiResponse } from "@/lib/api-streaming";

const uploadSchema = z.object({
  title: z.string().min(1, "Titel is verplicht"),
  subject: z.string().min(1, "Vak is verplicht"),
  content: z.string().min(10, "Inhoud moet minimaal 10 karakters bevatten"),
  fileType: z.string().default("tekst"),
  chapter: z.string().optional(),
  examType: z.string().optional(),
  tags: z.string().optional(),
});

export default function Materialen() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const initialTab = searchParams.get("tab") || "upload";

  const [activeTab, setActiveTab] = useState(initialTab);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [activeMaterialId, setActiveMaterialId] = useState<number | null>(null);
  const [summary, setSummary] = useState("");
  const [quizData, setQuizData] = useState<Quiz | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

  // File upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [slideViewerOpen, setSlideViewerOpen] = useState(false);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string>>({});
  const [submittedAnswers, setSubmittedAnswers] = useState<Record<number, { selectedAnswer: string; isCorrect: boolean }>>({});
  const [showQuizResults, setShowQuizResults] = useState(false);

  const { data: materials = [], refetch: refetchMaterials } = useListStudyMaterials();
  const createMaterial = useCreateStudyMaterial();
  const deleteMaterial = useDeleteStudyMaterial();
  const generateQuiz = useGenerateQuiz();

  // Track which difficulty is being generated so the spinner shows on the right button
  const [pendingDifficulty, setPendingDifficulty] = useState<"makkelijk" | "gemiddeld" | "moeilijk" | null>(null);

  const handleDeleteMaterial = (id: number, title: string) => {
    if (!confirm(`Materiaal "${title}" verwijderen?`)) return;
    deleteMaterial.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: "Verwijderd", description: `"${title}" is verwijderd.` });
          if (activeMaterialId === id) {
            setActiveMaterialId(null);
            setSummary("");
            setQuizData(null);
          }
          refetchMaterials();
        },
        onError: () => toast({ title: "Verwijderen mislukt", variant: "destructive" }),
      },
    );
  };

  const uploadForm = useForm<z.infer<typeof uploadSchema>>({
    resolver: zodResolver(uploadSchema),
    defaultValues: {
      title: "",
      subject: "",
      content: "",
      fileType: "tekst",
      chapter: "",
      examType: "",
      tags: "",
    },
  });

  const onUploadSubmit = (values: z.infer<typeof uploadSchema>) => {
    createMaterial.mutate({ data: values }, {
      onSuccess: (data) => {
        toast({ title: "Succes", description: "Materiaal toegevoegd." });
        uploadForm.reset();
        setActiveMaterialId(data.id);
        setQuizData(null);
        resetQuizSession();
        setActiveTab("verwerken");
        refetchMaterials();
      },
      onError: () => {
        toast({ title: "Fout", description: "Kon materiaal niet toevoegen.", variant: "destructive" });
      }
    });
  };

  const handleFileUpload = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("title", uploadForm.getValues("title") || selectedFile.name.replace(/\.[^.]+$/, ""));
    formData.append("subject", uploadForm.getValues("subject") || "Onbekend");
    if (uploadForm.getValues("chapter")) formData.append("chapter", uploadForm.getValues("chapter") || "");
    if (uploadForm.getValues("examType")) formData.append("examType", uploadForm.getValues("examType") || "");
    if (uploadForm.getValues("tags")) formData.append("tags", uploadForm.getValues("tags") || "");

    try {
      const res = await fetch(import.meta.env.BASE_URL + "api/study-materials/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload mislukt");
      }

      const data = await res.json();
      toast({ title: "Succes", description: `"${data.title}" is geüpload en verwerkt.` });
      setActiveMaterialId(data.id);
      setSelectedFile(null);
      uploadForm.reset();
      setQuizData(null);
      resetQuizSession();
      setActiveTab("verwerken");
      refetchMaterials();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Kon bestand niet uploaden.";
      toast({ title: "Fout", description: message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleSummarize = async () => {
    if (!activeMaterialId) return;

    setIsSummarizing(true);
    setSummary("");

    try {
      await streamOpenAiResponse(
        `api/materials/${activeMaterialId}/summarize`,
        {},
        (chunk) => {
          setSummary(prev => prev + chunk);
        }
      );
      refetchMaterials();
    } catch (error) {
      toast({ title: "Fout", description: "Samenvatten mislukt.", variant: "destructive" });
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleGenerateQuiz = (difficulty: 'makkelijk' | 'gemiddeld' | 'moeilijk') => {
    if (!activeMaterialId) return;

    setPendingDifficulty(difficulty);
    generateQuiz.mutate({
      id: activeMaterialId,
      data: { difficulty, numQuestions: 5 }
    }, {
      onSuccess: (data) => {
        resetQuizSession();
        setQuizData(data);
        setActiveTab("quiz");
        setPendingDifficulty(null);
        toast({ title: "Quiz gegenereerd", description: "5 nieuwe vragen staan klaar." });
      },
      onError: () => {
        setPendingDifficulty(null);
        toast({ title: "Fout", description: "Kon quiz niet genereren.", variant: "destructive" });
      }
    });
  };

  const handleChatAboutMaterial = (title: string) => {
    const chatMessage = encodeURIComponent(`Leg ${title} uit en stel me er vragen over`);
    navigate(`/?chat=${chatMessage}`);
  };

  const resetQuizSession = () => {
    setCurrentQuestionIndex(0);
    setSelectedAnswers({});
    setSubmittedAnswers({});
    setShowQuizResults(false);
  };

  const getQuestionOptions = (question: QuizQuestion) => {
    const uniqueOptions = Array.from(
      new Set(
        [...(question.options ?? []), question.correctAnswer]
          .map((option) => option.trim())
          .filter(Boolean),
      ),
    );

    if (uniqueOptions.length === 1) {
      return [uniqueOptions[0], "Ik weet het nog niet zeker"];
    }

    return uniqueOptions;
  };

  const handleSelectMaterial = (materialId: number) => {
    const nextMaterial = materials.find((material) => material.id === materialId);
    setActiveMaterialId(materialId);
    setSummary(nextMaterial?.summary || "");
    if (quizData?.materialId !== materialId) {
      setQuizData(null);
      resetQuizSession();
    }
    setActiveTab("verwerken");
  };

  const activeMaterial = materials.find((material) => material.id === activeMaterialId);
  const totalQuestions = quizData?.questions.length ?? 0;
  const currentQuestion = quizData?.questions[currentQuestionIndex];
  const currentSelection = selectedAnswers[currentQuestionIndex] ?? "";
  const currentSubmission = submittedAnswers[currentQuestionIndex];
  const answeredCount = Object.keys(submittedAnswers).length;
  const correctCount = Object.values(submittedAnswers).filter((entry) => entry.isCorrect).length;
  const progressValue = totalQuestions > 0 ? (answeredCount / totalQuestions) * 100 : 0;
  const scorePercentage = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
  const resultCopy =
    scorePercentage >= 80
      ? {
          title: "Sterk gedaan",
          description: "Je beheerst deze stof al goed. Nog een ronde en je zit dicht bij toetsniveau.",
        }
      : scorePercentage >= 60
        ? {
            title: "Goede basis",
            description: "De kern zit erin. Herhaal vooral de vragen die je nu fout had en probeer daarna opnieuw.",
          }
        : {
            title: "Nog even aanscherpen",
            description: "Juist nu is oefenen waardevol. Loop de uitleg door en pak daarna nog een quizronde.",
          };

  const handleSelectAnswer = (answer: string) => {
    if (currentSubmission) return;
    setSelectedAnswers((prev) => ({ ...prev, [currentQuestionIndex]: answer }));
  };

  const handleSubmitAnswer = () => {
    if (!currentQuestion || !currentSelection || currentSubmission) return;

    setSubmittedAnswers((prev) => ({
      ...prev,
      [currentQuestionIndex]: {
        selectedAnswer: currentSelection,
        isCorrect: currentSelection === currentQuestion.correctAnswer,
      },
    }));
  };

  const handleAdvanceQuiz = () => {
    if (!quizData) return;
    if (currentQuestionIndex >= quizData.questions.length - 1) {
      setShowQuizResults(true);
      return;
    }
    setCurrentQuestionIndex((prev) => prev + 1);
  };

  return (
    <div className="h-full flex flex-col space-y-6">
      {/* Slide Viewer (fullscreen overlay) */}
      {activeMaterial && (
        <SlideViewer
          content={activeMaterial.content}
          title={activeMaterial.title}
          subject={activeMaterial.subject}
          open={slideViewerOpen}
          onClose={() => setSlideViewerOpen(false)}
        />
      )}

      <header>
        <h1 className="text-xl md:text-3xl font-bold text-foreground">Studiemateriaal</h1>
        <p className="text-muted-foreground text-xs md:text-sm mt-0.5 hidden md:block">Upload lesstof, bekijk samenvattingen en genereer oefeningen.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 flex-1 min-h-0">
        {/* Left sidebar - Material list */}
        <Card className="md:col-span-3 flex flex-col overflow-hidden">
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-lg">Mijn Materialen</CardTitle>
          </CardHeader>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              <Button
                variant={activeTab === "upload" ? "secondary" : "ghost"}
                className="w-full justify-start"
                onClick={() => setActiveTab("upload")}
              >
                <FileUp className="mr-2 h-4 w-4" /> Nieuw toevoegen
              </Button>
              <div className="py-2">
                <div className="text-xs font-medium text-muted-foreground px-3 mb-2">RECENT</div>
                {materials.map((material: { id: number; title: string; summary?: string; subject?: string }) => (
                  <div key={material.id} className="flex items-center gap-1">
                    <Button
                      variant={activeMaterialId === material.id && activeTab !== "upload" ? "secondary" : "ghost"}
                      className="flex-1 justify-start text-sm font-normal truncate"
                      onClick={() => handleSelectMaterial(material.id)}
                    >
                      <FileText className="mr-2 h-4 w-4 flex-shrink-0" />
                      <span className="truncate">{material.title}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 flex-shrink-0"
                      title="Chat over dit materiaal"
                      onClick={() => handleChatAboutMaterial(material.title)}
                    >
                      <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 flex-shrink-0 text-destructive/50 hover:text-destructive"
                      title="Verwijder materiaal"
                      onClick={() => handleDeleteMaterial(material.id, material.title)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </ScrollArea>
        </Card>

        {/* Main content area */}
        <Card className="md:col-span-9 flex flex-col overflow-hidden">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
            <div className="px-6 pt-4 border-b">
              <TabsList>
                <TabsTrigger value="upload">Uploaden</TabsTrigger>
                <TabsTrigger value="verwerken" disabled={!activeMaterialId}>Verwerken</TabsTrigger>
                <TabsTrigger value="quiz" disabled={!activeMaterialId}>Oefenen</TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <TabsContent value="upload" className="m-0 h-full">
                <div className="max-w-2xl mx-auto space-y-6">
                  {/* File Upload Section */}
                  <Card className="border-dashed border-2 border-primary/30 bg-primary/5">
                    <CardContent className="p-6">
                      <div className="flex flex-col items-center text-center">
                        <Upload className="h-8 w-8 text-primary mb-3" />
                        <h3 className="font-semibold mb-1">Upload een bestand</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                          Upload een .pptx, .docx of .txt bestand. De tekst wordt automatisch geëxtraheerd.
                        </p>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".pptx,.docx,.txt,.md"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              setSelectedFile(file);
                              // Auto-fill title from filename if empty
                              if (!uploadForm.getValues("title")) {
                                uploadForm.setValue("title", file.name.replace(/\.[^.]+$/, ""));
                              }
                            }
                          }}
                        />
                        {selectedFile ? (
                          <div className="space-y-3 w-full">
                            <div className="flex items-center gap-2 p-2 rounded-lg bg-background border">
                              <FileUp className="h-4 w-4 text-primary shrink-0" />
                              <span className="text-sm font-medium truncate flex-1">{selectedFile.name}</span>
                              <Badge variant="outline" className="text-[10px]">
                                {(selectedFile.size / 1024).toFixed(0)} KB
                              </Badge>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-xs"
                                onClick={() => { setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                              >
                                Verwijder
                              </Button>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <Input
                                placeholder="Titel (optioneel)"
                                value={uploadForm.watch("title")}
                                onChange={(e) => uploadForm.setValue("title", e.target.value)}
                              />
                              <Input
                                placeholder="Vak (bijv. Biologie)"
                                value={uploadForm.watch("subject")}
                                onChange={(e) => uploadForm.setValue("subject", e.target.value)}
                              />
                            </div>
                            <Button
                              className="w-full"
                              onClick={handleFileUpload}
                              disabled={isUploading}
                            >
                              {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                              Upload & Verwerk
                            </Button>
                          </div>
                        ) : (
                          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                            <FileUp className="mr-2 h-4 w-4" /> Kies bestand
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <div className="relative">
                    <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-background px-2 text-muted-foreground">of plak tekst</span>
                    </div>
                  </div>

                  {/* Text Paste Form */}
                  <Form {...uploadForm}>
                    <form onSubmit={uploadForm.handleSubmit(onUploadSubmit)} className="space-y-6">
                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={uploadForm.control}
                          name="title"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Titel</FormLabel>
                              <FormControl>
                                <div className="flex gap-2">
                                  <Input placeholder="Bijv. Hoofdstuk 3: Celdeling" {...field} />
                                  <SpeechButton onTranscript={(t) => field.onChange(field.value ? field.value + " " + t : t)} />
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={uploadForm.control}
                          name="subject"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Vak</FormLabel>
                              <FormControl>
                                <Input placeholder="Bijv. Biologie" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={uploadForm.control}
                          name="chapter"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Hoofdstuk (optioneel)</FormLabel>
                              <FormControl>
                                <Input placeholder="Bijv. Hoofdstuk 3" {...field} />
                              </FormControl>
                              <FormDescription className="text-xs">
                                Welk hoofdstuk of paragraaf?
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={uploadForm.control}
                          name="examType"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Type toets</FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Selecteer type..." />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="se">SE (Schoolexamen)</SelectItem>
                                  <SelectItem value="ce">CE (Centraal Examen)</SelectItem>
                                  <SelectItem value="beide">Beide</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <FormField
                        control={uploadForm.control}
                        name="tags"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Onderwerp-tags (optioneel)</FormLabel>
                            <FormControl>
                              <Input placeholder="Bijv. mitose, meiose, celcyclus" {...field} />
                            </FormControl>
                            <FormDescription className="text-xs">
                              Komma-gescheiden trefwoorden voor dit materiaal.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={uploadForm.control}
                        name="content"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex items-center justify-between">
                              Tekst of Notities
                              <SpeechButton
                                size="sm"
                                onTranscript={(t) => field.onChange(field.value ? field.value + " " + t : t)}
                              />
                            </FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder="Plak hier je lesstof, samenvatting of notities... of spreek in via de microfoon."
                                className="min-h-[250px] resize-y"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <Button type="submit" className="w-full" disabled={createMaterial.isPending}>
                        {createMaterial.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Opslaan &amp; Verwerken
                      </Button>
                    </form>
                  </Form>
                </div>
              </TabsContent>

              <TabsContent value="verwerken" className="m-0">
                {activeMaterial && (
                  <div className="space-y-6">
                    <div className="flex items-start justify-between">
                      <div>
                        <h2 className="text-2xl font-bold">{activeMaterial.title}</h2>
                        <p className="text-muted-foreground">{activeMaterial.subject}</p>
                      </div>
                      <div className="flex gap-2">
                        {activeMaterial.fileType === "pptx" && (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => setSlideViewerOpen(true)}
                          >
                            <FileText className="mr-2 h-4 w-4" />
                            Presenteren
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleChatAboutMaterial(activeMaterial.title)}
                        >
                          <MessageSquare className="mr-2 h-4 w-4" />
                          Chat
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <Card className="shadow-none border-primary/20">
                        <CardHeader>
                          <CardTitle className="text-lg flex items-center gap-2">
                            <ListChecks className="h-5 w-5 text-primary" />
                            Slimme Samenvatting
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          {summary || activeMaterial.summary ? (
                            <div className="prose prose-sm dark:prose-invert max-w-none">
                              <div>{summary || activeMaterial.summary || ""}</div>
                            </div>
                          ) : (
                            <div className="text-center py-8">
                              <p className="text-muted-foreground mb-4">Laat de AI de belangrijkste kernconcepten voor je uithalen.</p>
                              <Button onClick={handleSummarize} disabled={isSummarizing}>
                                {isSummarizing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BrainCircuit className="mr-2 h-4 w-4" />}
                                Samenvatting Genereren
                              </Button>
                            </div>
                          )}
                        </CardContent>
                      </Card>

                      <Card className="shadow-none border-primary/20">
                        <CardHeader>
                          <CardTitle className="text-lg flex items-center gap-2">
                            <BrainCircuit className="h-5 w-5 text-primary" />
                            Overhoor Mij
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <p className="text-sm text-muted-foreground">Genereer oefenvragen gebaseerd op deze tekst om je kennis te testen.</p>

                          <div className="space-y-3 pt-4 border-t">
                            <Button
                              variant="outline"
                              className="w-full justify-between"
                              onClick={() => handleGenerateQuiz('makkelijk')}
                              disabled={generateQuiz.isPending}
                            >
                              Makkelijk (Begrippen)
                              {pendingDifficulty === "makkelijk" && <Loader2 className="h-4 w-4 animate-spin" />}
                            </Button>
                            <Button
                              variant="outline"
                              className="w-full justify-between"
                              onClick={() => handleGenerateQuiz('gemiddeld')}
                              disabled={generateQuiz.isPending}
                            >
                              Gemiddeld (Toepassing)
                              {pendingDifficulty === "gemiddeld" && <Loader2 className="h-4 w-4 animate-spin" />}
                            </Button>
                            <Button
                              variant="outline"
                              className="w-full justify-between"
                              onClick={() => handleGenerateQuiz('moeilijk')}
                              disabled={generateQuiz.isPending}
                            >
                              Moeilijk (Inzicht)
                              {pendingDifficulty === "moeilijk" && <Loader2 className="h-4 w-4 animate-spin" />}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="quiz" className="m-0 max-w-3xl mx-auto">
                {quizData && totalQuestions > 0 ? (
                  <div className="space-y-6">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h2 className="text-2xl font-bold">Quiz: {activeMaterial?.title}</h2>
                          <p className="text-sm text-muted-foreground">
                            Eerst antwoorden, daarna pas feedback. Zo voelt het als echt overhoren.
                          </p>
                        </div>
                        <Badge variant="outline">{totalQuestions} Vragen</Badge>
                      </div>
                      <Progress value={showQuizResults ? 100 : progressValue} className="h-2.5" />
                    </div>

                    {showQuizResults ? (
                      <div className="space-y-5">
                        <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-background to-background shadow-sm">
                          <CardHeader className="space-y-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="space-y-1">
                                <CardTitle className="flex items-center gap-2 text-2xl">
                                  <Trophy className="h-6 w-6 text-primary" />
                                  {resultCopy.title}
                                </CardTitle>
                                <CardDescription>{resultCopy.description}</CardDescription>
                              </div>
                              <Badge className="px-3 py-1 text-sm">{correctCount}/{totalQuestions} goed</Badge>
                            </div>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                              <div className="rounded-2xl border bg-background/80 p-4">
                                <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Score</div>
                                <div className="mt-2 text-3xl font-bold text-primary">{scorePercentage}%</div>
                              </div>
                              <div className="rounded-2xl border bg-background/80 p-4">
                                <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Goed</div>
                                <div className="mt-2 text-3xl font-bold">{correctCount}</div>
                              </div>
                              <div className="rounded-2xl border bg-background/80 p-4">
                                <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Herhalen</div>
                                <div className="mt-2 text-3xl font-bold">{totalQuestions - correctCount}</div>
                              </div>
                            </div>
                          </CardHeader>
                          <CardFooter className="flex flex-col gap-3 sm:flex-row sm:justify-between">
                            <Button variant="outline" onClick={resetQuizSession} className="w-full sm:w-auto">
                              <RotateCcw className="mr-2 h-4 w-4" />
                              Opnieuw maken
                            </Button>
                            <Button onClick={() => setActiveTab("verwerken")} className="w-full sm:w-auto">
                              Nieuwe quiz genereren
                            </Button>
                          </CardFooter>
                        </Card>

                        <div className="space-y-3">
                          {quizData.questions.map((question, index) => {
                            const submission = submittedAnswers[index];
                            const options = getQuestionOptions(question);
                            const isCorrect = submission?.isCorrect ?? false;

                            return (
                              <Card key={`${question.question}-${index}`} className="border-border/70 shadow-none">
                                <CardHeader className="space-y-3">
                                  <div className="flex flex-wrap items-center justify-between gap-3">
                                    <Badge variant="outline">Vraag {index + 1}</Badge>
                                    <Badge className={cn(isCorrect ? "bg-emerald-600 hover:bg-emerald-600" : "bg-destructive hover:bg-destructive")}>
                                      {isCorrect ? "Goed" : "Nog oefenen"}
                                    </Badge>
                                  </div>
                                  <CardTitle className="text-lg leading-relaxed">{question.question}</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                  <div className="grid gap-3">
                                    {options.map((option) => {
                                      const isSelected = submission?.selectedAnswer === option;
                                      const isRightAnswer = question.correctAnswer === option;

                                      return (
                                        <div
                                          key={option}
                                          className={cn(
                                            "rounded-2xl border px-4 py-3 text-sm",
                                            isRightAnswer && "border-emerald-500 bg-emerald-500/10",
                                            isSelected && !isRightAnswer && "border-destructive bg-destructive/10",
                                            !isSelected && !isRightAnswer && "border-border/70 bg-background",
                                          )}
                                        >
                                          {option}
                                        </div>
                                      );
                                    })}
                                  </div>
                                  <div className="rounded-2xl border bg-muted/30 p-4 text-sm">
                                    <div className="font-medium">
                                      Jouw antwoord: {submission?.selectedAnswer ?? "Niet ingevuld"}
                                    </div>
                                    <div className="mt-1 font-medium text-primary">
                                      Goed antwoord: {question.correctAnswer}
                                    </div>
                                    {question.explanation ? (
                                      <p className="mt-3 text-muted-foreground">{question.explanation}</p>
                                    ) : null}
                                  </div>
                                </CardContent>
                              </Card>
                            );
                          })}
                        </div>
                      </div>
                    ) : currentQuestion ? (
                      <Card className="overflow-hidden border-primary/20 shadow-sm">
                        <CardHeader className="space-y-5 border-b bg-gradient-to-br from-primary/5 via-background to-background">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <Badge variant="outline">Vraag {currentQuestionIndex + 1} van {totalQuestions}</Badge>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Target className="h-4 w-4 text-primary" />
                              <span>{correctCount} goed beantwoord</span>
                            </div>
                          </div>
                          <CardTitle className="text-2xl leading-snug">{currentQuestion.question}</CardTitle>
                          <CardDescription>
                            Kies het beste antwoord en controleer pas daarna.
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4 p-6">
                          <div className="grid gap-3">
                            {getQuestionOptions(currentQuestion).map((option) => {
                              const isSelected = currentSelection === option;
                              const isWrongSelection = currentSubmission && !currentSubmission.isCorrect && currentSelection === option;
                              const shouldHighlightCorrectAnswer = Boolean(currentSubmission) && currentQuestion.correctAnswer === option;

                              return (
                                <button
                                  key={option}
                                  type="button"
                                  onClick={() => handleSelectAnswer(option)}
                                  disabled={Boolean(currentSubmission)}
                                  className={cn(
                                    "w-full rounded-2xl border px-4 py-4 text-left text-sm transition-all",
                                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-default",
                                    isSelected && !currentSubmission && "border-primary bg-primary/10 shadow-sm",
                                    !isSelected && !currentSubmission && "border-border/70 hover:border-primary/40 hover:bg-muted/40",
                                    shouldHighlightCorrectAnswer && "border-emerald-500 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100",
                                    isWrongSelection && "border-destructive bg-destructive/10 text-destructive",
                                  )}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <span className="font-medium leading-relaxed">{option}</span>
                                    {shouldHighlightCorrectAnswer ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" /> : null}
                                    {isWrongSelection ? <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0" /> : null}
                                  </div>
                                </button>
                              );
                            })}
                          </div>

                          {currentSubmission ? (
                            <div
                              className={cn(
                                "rounded-2xl border p-4",
                                currentSubmission.isCorrect
                                  ? "border-emerald-500/40 bg-emerald-500/10"
                                  : "border-destructive/40 bg-destructive/10",
                              )}
                            >
                              <div className="flex items-center gap-2 font-semibold">
                                {currentSubmission.isCorrect ? (
                                  <>
                                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                                    Goed bezig
                                  </>
                                ) : (
                                  <>
                                    <XCircle className="h-5 w-5 text-destructive" />
                                    Bijna, maar dit is het goede antwoord
                                  </>
                                )}
                              </div>
                              <p className="mt-2 text-sm font-medium">
                                Goed antwoord: {currentQuestion.correctAnswer}
                              </p>
                              {currentQuestion.explanation ? (
                                <p className="mt-3 text-sm text-muted-foreground">{currentQuestion.explanation}</p>
                              ) : null}
                            </div>
                          ) : null}
                        </CardContent>
                        <CardFooter className="flex flex-col gap-3 border-t bg-muted/10 p-6 sm:flex-row sm:justify-between">
                          <Button
                            variant="outline"
                            onClick={resetQuizSession}
                            disabled={answeredCount === 0 && !currentSelection}
                            className="w-full sm:w-auto"
                          >
                            <RotateCcw className="mr-2 h-4 w-4" />
                            Opnieuw starten
                          </Button>
                          {currentSubmission ? (
                            <Button onClick={handleAdvanceQuiz} className="w-full sm:w-auto">
                              {currentQuestionIndex === totalQuestions - 1 ? "Bekijk score" : "Volgende vraag"}
                              <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                          ) : (
                            <Button onClick={handleSubmitAnswer} disabled={!currentSelection} className="w-full sm:w-auto">
                              Controleer antwoord
                            </Button>
                          )}
                        </CardFooter>
                      </Card>
                    ) : null}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <p className="text-muted-foreground">Genereer eerst een quiz via het tabblad Verwerken.</p>
                  </div>
                )}
              </TabsContent>
            </div>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}
