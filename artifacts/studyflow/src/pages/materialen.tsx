import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, FileUp, ListChecks, BrainCircuit, Loader2, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { 
  useListStudyMaterials, 
  useCreateStudyMaterial,
  useGenerateQuiz,
  useGenerateExercises
} from "@workspace/api-client-react";
import { streamOpenAiResponse } from "@/lib/api-streaming";

const uploadSchema = z.object({
  title: z.string().min(1, "Titel is verplicht"),
  subject: z.string().min(1, "Vak is verplicht"),
  content: z.string().min(10, "Inhoud moet minimaal 10 karakters bevatten"),
  fileType: z.string().default("tekst"),
});

export default function Materialen() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("upload");
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [activeMaterialId, setActiveMaterialId] = useState<number | null>(null);
  const [summary, setSummary] = useState("");
  const [quizData, setQuizData] = useState<any>(null);
  
  const { data: materials = [], refetch: refetchMaterials } = useListStudyMaterials();
  const createMaterial = useCreateStudyMaterial();
  const generateQuiz = useGenerateQuiz();
  const generateExercises = useGenerateExercises();

  const uploadForm = useForm<z.infer<typeof uploadSchema>>({
    resolver: zodResolver(uploadSchema),
    defaultValues: {
      title: "",
      subject: "",
      content: "",
      fileType: "tekst",
    },
  });

  const onUploadSubmit = (values: z.infer<typeof uploadSchema>) => {
    createMaterial.mutate({ data: values }, {
      onSuccess: (data) => {
        toast({ title: "Succes", description: "Materiaal toegevoegd." });
        uploadForm.reset();
        setActiveMaterialId(data.id);
        setActiveTab("verwerken");
        refetchMaterials();
      },
      onError: () => {
        toast({ title: "Fout", description: "Kon materiaal niet toevoegen.", variant: "destructive" });
      }
    });
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
    
    generateQuiz.mutate({ 
      id: activeMaterialId, 
      data: { difficulty, numQuestions: 5 } 
    }, {
      onSuccess: (data) => {
        setQuizData(data);
        setActiveTab("quiz");
        toast({ title: "Quiz gegenereerd", description: "Succesvol 5 vragen gemaakt." });
      },
      onError: () => {
        toast({ title: "Fout", description: "Kon quiz niet genereren.", variant: "destructive" });
      }
    });
  };

  const activeMaterial = materials.find(m => m.id === activeMaterialId);

  return (
    <div className="h-full flex flex-col space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-foreground">Studiemateriaal</h1>
        <p className="text-muted-foreground mt-1">Upload lesstof, bekijk samenvattingen en genereer oefeningen.</p>
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
                {materials.map(material => (
                  <Button
                    key={material.id}
                    variant={activeMaterialId === material.id && activeTab !== "upload" ? "secondary" : "ghost"}
                    className="w-full justify-start text-sm font-normal truncate"
                    onClick={() => {
                      setActiveMaterialId(material.id);
                      setSummary(material.summary || "");
                      setActiveTab("verwerken");
                    }}
                  >
                    <FileText className="mr-2 h-4 w-4 flex-shrink-0" />
                    <span className="truncate">{material.title}</span>
                  </Button>
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
                <div className="max-w-2xl mx-auto">
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
                                <Input placeholder="Bijv. Hoofdstuk 3: Celdeling" {...field} />
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
                      
                      <FormField
                        control={uploadForm.control}
                        name="content"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Tekst of Notities</FormLabel>
                            <FormControl>
                              <Textarea 
                                placeholder="Plak hier je lesstof, samenvatting of notities..." 
                                className="min-h-[300px] resize-y" 
                                {...field} 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <Button type="submit" className="w-full" disabled={createMaterial.isPending}>
                        {createMaterial.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Opslaan & Verwerken
                      </Button>
                    </form>
                  </Form>
                </div>
              </TabsContent>

              <TabsContent value="verwerken" className="m-0">
                {activeMaterial && (
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-2xl font-bold">{activeMaterial.title}</h2>
                      <p className="text-muted-foreground">{activeMaterial.subject}</p>
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
                              <div dangerouslySetInnerHTML={{ __html: summary || activeMaterial.summary || "" }} />
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
                            <Button variant="outline" className="w-full justify-between" onClick={() => handleGenerateQuiz('makkelijk')} disabled={generateQuiz.isPending}>
                              Makkelijk (Begrippen)
                              {generateQuiz.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                            </Button>
                            <Button variant="outline" className="w-full justify-between" onClick={() => handleGenerateQuiz('gemiddeld')} disabled={generateQuiz.isPending}>
                              Gemiddeld (Toepassing)
                            </Button>
                            <Button variant="outline" className="w-full justify-between" onClick={() => handleGenerateQuiz('moeilijk')} disabled={generateQuiz.isPending}>
                              Moeilijk (Inzicht)
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="quiz" className="m-0 max-w-3xl mx-auto">
                {quizData ? (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <h2 className="text-2xl font-bold">Quiz: {activeMaterial?.title}</h2>
                      <Badge variant="outline">{quizData.questions.length} Vragen</Badge>
                    </div>

                    <Accordion type="single" collapsible className="w-full">
                      {quizData.questions.map((q: any, idx: number) => (
                        <AccordionItem value={`q-${idx}`} key={idx}>
                          <AccordionTrigger className="text-left font-medium">
                            <span className="flex gap-3">
                              <span className="text-primary font-bold">{idx + 1}.</span>
                              <span>{q.question}</span>
                            </span>
                          </AccordionTrigger>
                          <AccordionContent className="pt-4 pb-6 pl-8">
                            {q.options && q.options.length > 0 ? (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                                {q.options.map((opt: string, i: number) => (
                                  <div key={i} className="p-3 border rounded-md text-sm">{opt}</div>
                                ))}
                              </div>
                            ) : null}
                            
                            <div className="mt-4 p-4 bg-muted/30 rounded-lg border border-primary/20">
                              <h5 className="font-semibold text-primary flex items-center gap-2 mb-2">
                                <CheckCircle2 className="h-4 w-4" /> Antwoord
                              </h5>
                              <p className="font-medium mb-2">{q.correctAnswer}</p>
                              {q.explanation && <p className="text-sm text-muted-foreground">{q.explanation}</p>}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
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
